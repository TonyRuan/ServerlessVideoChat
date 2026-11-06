// Experimental encrypted-file relay. File keys and plaintext stay in the browsers.
package main

import (
	"context"
	"crypto/tls"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/quic-go/quic-go"
	"github.com/quic-go/quic-go/http3"
	"github.com/quic-go/webtransport-go"
)

const maxFrameBytes = 256*1024 + 4096 + 12 + 16
const maxWireBytes int64 = 2*1024*1024*1024 + 64*1024*1024

var roomPattern = regexp.MustCompile(`^[a-f0-9]{64}$`)
var errLimit = errors.New("relay capacity reached")

type config struct {
	bind, cert, key                 string
	origins                         map[string]bool
	maxRooms, perIP                 int
	handshake, pair, idle, lifetime time.Duration
}

func envInt(name string, fallback int) (int, error) {
	if os.Getenv(name) == "" {
		return fallback, nil
	}
	n, err := strconv.Atoi(os.Getenv(name))
	if err != nil || n < 1 {
		return 0, fmt.Errorf("invalid %s", name)
	}
	return n, nil
}
func loadConfig() (config, error) {
	c := config{bind: os.Getenv("WT_BIND"), cert: os.Getenv("WT_CERT_FILE"), key: os.Getenv("WT_KEY_FILE"), origins: map[string]bool{}, handshake: 10 * time.Second, pair: 25 * time.Second, idle: 60 * time.Second, lifetime: 60 * time.Minute}
	if c.bind == "" {
		c.bind = "127.0.0.1:4433"
	}
	if c.cert == "" || c.key == "" {
		return c, errors.New("WT_CERT_FILE and WT_KEY_FILE are required")
	}
	for _, raw := range strings.Split(os.Getenv("WT_ORIGINS"), ",") {
		u, err := url.Parse(raw)
		if err != nil || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || u.Path != "" || (u.Scheme != "https" && !(u.Scheme == "http" && (u.Hostname() == "localhost" || u.Hostname() == "127.0.0.1"))) {
			return c, errors.New("WT_ORIGINS requires exact HTTPS origins (HTTP permitted only for localhost)")
		}
		c.origins[raw] = true
	}
	var err error
	if c.maxRooms, err = envInt("WT_MAX_ROOMS", 64); err != nil {
		return c, err
	}
	if c.perIP, err = envInt("WT_MAX_SESSIONS_PER_IP", 16); err != nil {
		return c, err
	}
	return c, nil
}

type handshake struct {
	Version int    `json:"version"`
	Room    string `json:"room"`
	Role    string `json:"role"`
}

func readHandshake(r io.Reader) (handshake, error) {
	var h handshake
	var n uint32
	if err := binary.Read(r, binary.BigEndian, &n); err != nil {
		return h, err
	}
	if n == 0 || n > 512 {
		return h, errors.New("invalid handshake size")
	}
	b := make([]byte, n)
	if _, err := io.ReadFull(r, b); err != nil {
		return h, err
	}
	dec := json.NewDecoder(strings.NewReader(string(b)))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&h); err != nil {
		return h, errors.New("invalid handshake")
	}
	if dec.Decode(new(any)) != io.EOF || h.Version != 1 || !roomPattern.MatchString(h.Room) || (h.Role != "send" && h.Role != "receive") {
		return h, errors.New("invalid handshake")
	}
	return h, nil
}

type wireStream interface {
	io.Reader
	io.Writer
	Close() error
	SetReadDeadline(time.Time) error
	SetWriteDeadline(time.Time) error
}
type participant struct {
	stream wireStream
	close  func()
}
type room struct {
	send, receive *participant
	ready, done   chan struct{}
	once          sync.Once
}
type manager struct {
	mu                        sync.Mutex
	rooms                     map[string]*room
	ips                       map[string]int
	sessions, maxRooms, perIP int
}

func newManager(c config) *manager {
	return &manager{rooms: map[string]*room{}, ips: map[string]int{}, maxRooms: c.maxRooms, perIP: c.perIP}
}
func (m *manager) admit(ip string) (func(), error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.sessions >= m.maxRooms*2 || m.ips[ip] >= m.perIP {
		return nil, errLimit
	}
	m.sessions++
	m.ips[ip]++
	var once sync.Once
	return func() {
		once.Do(func() {
			m.mu.Lock()
			defer m.mu.Unlock()
			m.sessions--
			m.ips[ip]--
			if m.ips[ip] == 0 {
				delete(m.ips, ip)
			}
		})
	}, nil
}
func (m *manager) join(h handshake, p *participant) (*room, bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	rm := m.rooms[h.Room]
	if rm == nil {
		if len(m.rooms) >= m.maxRooms {
			return nil, false, errLimit
		}
		rm = &room{ready: make(chan struct{}), done: make(chan struct{})}
		m.rooms[h.Room] = rm
	}
	if h.Role == "send" {
		if rm.send != nil {
			return nil, false, errors.New("duplicate role")
		}
		rm.send = p
	} else {
		if rm.receive != nil {
			return nil, false, errors.New("duplicate role")
		}
		rm.receive = p
	}
	paired := rm.send != nil && rm.receive != nil
	if paired {
		close(rm.ready)
	}
	return rm, paired, nil
}
func (m *manager) finish(id string, rm *room) {
	rm.once.Do(func() {
		m.mu.Lock()
		if m.rooms[id] == rm {
			delete(m.rooms, id)
		}
		s, r := rm.send, rm.receive
		close(rm.done)
		m.mu.Unlock()
		if s != nil {
			s.close()
		}
		if r != nil {
			r.close()
		}
	})
}

// Reads at most one bounded frame at a time. QUIC write blocking propagates to reads.
func forwardFrames(dst, src wireStream, idle time.Duration, limit int64) error {
	var total int64
	buf := make([]byte, 64*1024)
	for {
		src.SetReadDeadline(time.Now().Add(idle))
		var header [4]byte
		if _, err := io.ReadFull(src, header[:]); err != nil {
			return err
		}
		n := binary.BigEndian.Uint32(header[:])
		if n < 29 || n > maxFrameBytes {
			return errors.New("invalid frame size")
		}
		total += int64(n) + 4
		if total > limit {
			return errors.New("file quota exceeded")
		}
		dst.SetWriteDeadline(time.Now().Add(idle))
		if _, err := dst.Write(header[:]); err != nil {
			return err
		}
		written, err := io.CopyBuffer(dst, io.LimitReader(src, int64(n)), buf)
		if err != nil {
			return err
		}
		if written != int64(n) {
			return io.ErrUnexpectedEOF
		}
	}
}

func handler(c config, m *manager, server *webtransport.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/file" || r.URL.RawQuery != "" {
			http.NotFound(w, r)
			return
		}
		if !c.origins[r.Header.Get("Origin")] {
			http.Error(w, "origin denied", http.StatusForbidden)
			return
		}
		ip, _, err := net.SplitHostPort(r.RemoteAddr)
		if err != nil {
			http.Error(w, "invalid address", 400)
			return
		}
		release, err := m.admit(ip)
		if err != nil {
			http.Error(w, "busy", 429)
			return
		}
		defer release()
		sess, err := server.Upgrade(w, r)
		if err != nil {
			return
		}
		defer sess.CloseWithError(0, "file session closed")
		ctx, cancel := context.WithTimeout(sess.Context(), c.lifetime)
		defer cancel()
		handshakeCtx, stopHandshake := context.WithTimeout(ctx, c.handshake)
		stream, err := sess.AcceptStream(handshakeCtx)
		stopHandshake()
		if err != nil {
			return
		}
		stream.SetReadDeadline(time.Now().Add(c.handshake))
		h, err := readHandshake(stream)
		if err != nil {
			return
		}
		rm, paired, err := m.join(h, &participant{stream: stream, close: func() { sess.CloseWithError(1, "file session ended") }})
		if err != nil {
			return
		}
		defer m.finish(h.Room, rm)
		if paired {
			go func() {
				defer m.finish(h.Room, rm)
				for _, p := range []*participant{rm.send, rm.receive} {
					p.stream.SetWriteDeadline(time.Now().Add(c.handshake))
					if _, err := p.stream.Write([]byte{82}); err != nil {
						return
					}
				}
				err := forwardFrames(rm.receive.stream, rm.send.stream, c.idle, maxWireBytes)
				if errors.Is(err, io.EOF) {
					rm.receive.stream.Close()
					select {
					case <-rm.done:
					case <-time.After(5 * time.Second):
					}
				}
			}()
		}
		pairTimer := time.NewTimer(c.pair)
		defer pairTimer.Stop()
		select {
		case <-rm.ready:
		case <-pairTimer.C:
			return
		case <-ctx.Done():
			return
		case <-rm.done:
			return
		}
		select {
		case <-ctx.Done():
		case <-rm.done:
		}
	}
}

func main() {
	c, err := loadConfig()
	if err != nil {
		log.Fatal(err)
	}
	cert, err := tls.LoadX509KeyPair(c.cert, c.key)
	if err != nil {
		log.Fatal("unable to load TLS certificate/key")
	}
	m := newManager(c)
	s := &webtransport.Server{H3: &http3.Server{Addr: c.bind, TLSConfig: http3.ConfigureTLSConfig(&tls.Config{Certificates: []tls.Certificate{cert}, MinVersion: tls.VersionTLS13}), QUICConfig: &quic.Config{MaxIdleTimeout: c.idle, HandshakeIdleTimeout: c.handshake, EnableDatagrams: true, MaxIncomingStreams: 16, MaxIncomingUniStreams: 16, InitialStreamReceiveWindow: 1 << 20, MaxStreamReceiveWindow: 8 << 20, InitialConnectionReceiveWindow: 2 << 20, MaxConnectionReceiveWindow: 16 << 20}}, CheckOrigin: func(r *http.Request) bool { return c.origins[r.Header.Get("Origin")] }}
	s.H3.Handler = handler(c, m, s)
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	go func() { <-ctx.Done(); s.Close() }()
	log.Printf("experimental file relay listening UDP %s", c.bind)
	if err := s.ListenAndServe(); err != nil && ctx.Err() == nil {
		log.Fatal("relay listener stopped")
	}
}
