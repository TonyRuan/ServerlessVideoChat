package main

import (
	"bytes"
	"encoding/binary"
	"encoding/json"
	"errors"
	"io"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func framed(b []byte) []byte {
	var out bytes.Buffer
	binary.Write(&out, binary.BigEndian, uint32(len(b)))
	out.Write(b)
	return out.Bytes()
}
func TestHandshake(t *testing.T) {
	valid := handshake{1, strings.Repeat("a", 64), "send"}
	b, _ := json.Marshal(valid)
	got, err := readHandshake(bytes.NewReader(framed(b)))
	if err != nil || got != valid {
		t.Fatal(got, err)
	}
	for _, s := range []string{`{"version":1,"room":"short","role":"send"}`, `{"version":2,"room":"` + valid.Room + `","role":"send"}`, `{"version":1,"room":"` + valid.Room + `","role":"recv"}`, `{"version":1,"room":"` + valid.Room + `","role":"send","extra":true}`, string(b) + ` {}`} {
		if _, err := readHandshake(bytes.NewReader(framed([]byte(s)))); err == nil {
			t.Fatal("accepted invalid handshake")
		}
	}
	for _, b := range [][]byte{{0, 0, 0, 0}, {0, 0, 2, 1}, {0, 0, 0, 5, 'x'}} {
		if _, err := readHandshake(bytes.NewReader(b)); err == nil {
			t.Fatal("accepted malformed length")
		}
	}
}
func TestRoomPairAndCleanup(t *testing.T) {
	m := newManager(config{maxRooms: 2, perIP: 4})
	var closed atomic.Int32
	p := func() *participant { return &participant{close: func() { closed.Add(1) }} }
	h := handshake{1, strings.Repeat("b", 64), "send"}
	rm, paired, err := m.join(h, p())
	if err != nil || paired {
		t.Fatal(err)
	}
	if _, _, err = m.join(h, p()); err == nil {
		t.Fatal("accepted duplicate")
	}
	h.Role = "receive"
	same, paired, err := m.join(h, p())
	if err != nil || !paired || same != rm {
		t.Fatal("pair failed", err)
	}
	select {
	case <-rm.ready:
	default:
		t.Fatal("not ready")
	}
	var wg sync.WaitGroup
	for i := 0; i < 10; i++ {
		wg.Add(1)
		go func() { defer wg.Done(); m.finish(h.Room, rm) }()
	}
	wg.Wait()
	if closed.Load() != 2 || len(m.rooms) != 0 {
		t.Fatal("cleanup did not close exactly two peers")
	}
	select {
	case <-rm.done:
	default:
		t.Fatal("not finished")
	}
}
func TestAdmissionAndRoomLimits(t *testing.T) {
	m := newManager(config{maxRooms: 1, perIP: 1})
	release, err := m.admit("one")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = m.admit("one"); !errors.Is(err, errLimit) {
		t.Fatal("missing IP limit")
	}
	release2, err := m.admit("two")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = m.admit("three"); !errors.Is(err, errLimit) {
		t.Fatal("missing total limit")
	}
	release()
	release()
	release2()
	if m.sessions != 0 || len(m.ips) != 0 {
		t.Fatal("quota leaked")
	}
	first := handshake{1, strings.Repeat("c", 64), "send"}
	rm, _, _ := m.join(first, &participant{close: func() {}})
	if _, _, err = m.join(handshake{1, strings.Repeat("d", 64), "send"}, &participant{}); !errors.Is(err, errLimit) {
		t.Fatal("missing room limit")
	}
	m.finish(first.Room, rm)
	if _, _, err = m.join(handshake{1, strings.Repeat("d", 64), "send"}, &participant{}); err != nil {
		t.Fatal("room not released")
	}
}

type mockStream struct {
	bytes.Buffer
	readDeadline, writeDeadline time.Time
}

func (s *mockStream) Close() error                       { return nil }
func (s *mockStream) SetReadDeadline(v time.Time) error  { s.readDeadline = v; return nil }
func (s *mockStream) SetWriteDeadline(v time.Time) error { s.writeDeadline = v; return nil }
func TestForwardFrames(t *testing.T) {
	payload := framed(bytes.Repeat([]byte{19}, 50000))
	payload = append(payload, framed(bytes.Repeat([]byte{33}, 30000))...)
	src := &mockStream{}
	src.Write(payload)
	dst := &mockStream{}
	err := forwardFrames(dst, src, time.Second, maxWireBytes)
	if !errors.Is(err, io.EOF) || !bytes.Equal(dst.Bytes(), payload) {
		t.Fatal("forward mismatch", err)
	}
	if src.readDeadline.IsZero() || dst.writeDeadline.IsZero() {
		t.Fatal("deadlines absent")
	}
}
func TestForwardRejectsTruncationOversizeAndQuota(t *testing.T) {
	for _, test := range []struct {
		data  []byte
		limit int64
		want  error
	}{
		{append([]byte{0, 0, 0, 40}, bytes.Repeat([]byte{1}, 30)...), maxWireBytes, io.ErrUnexpectedEOF},
		{[]byte{0, 0, 0}, maxWireBytes, io.ErrUnexpectedEOF},
		{[]byte{0, 4, 255, 255}, maxWireBytes, nil},
		{framed([]byte{1}), maxWireBytes, nil},
		{framed(bytes.Repeat([]byte{1}, 40)), 40, nil},
	} {
		src := &mockStream{}
		src.Write(test.data)
		err := forwardFrames(&mockStream{}, src, time.Second, test.limit)
		if err == nil || (test.want != nil && !errors.Is(err, test.want)) {
			t.Fatal("bad rejection", err)
		}
	}
}
func TestConfigurationRejectsUnsafeOrigin(t *testing.T) {
	t.Setenv("WT_CERT_FILE", "cert.pem")
	t.Setenv("WT_KEY_FILE", "key.pem")
	for _, origin := range []string{"", "*", "https://example.com/path", "http://example.com", "https://user:pass@example.com", "https://example.com?x=1"} {
		t.Setenv("WT_ORIGINS", origin)
		if _, err := loadConfig(); err == nil {
			t.Fatal("accepted", origin)
		}
	}
	t.Setenv("WT_ORIGINS", "https://chat.example.com,http://127.0.0.1:5173")
	c, err := loadConfig()
	if err != nil || !c.origins["https://chat.example.com"] {
		t.Fatal(err)
	}
	t.Setenv("WT_MAX_ROOMS", "0")
	if _, err := loadConfig(); err == nil {
		t.Fatal("accepted zero limit")
	}
}
