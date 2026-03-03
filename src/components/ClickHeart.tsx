import { useEffect, useState, useRef } from 'react';
import { useHeartStore, type HeartData } from '../stores/heartStore';

interface Heart extends HeartData {
  // We use the same interface but render using absolute pixels calculated from relative
}

const ClickHeart = () => {
  const [hearts, setHearts] = useState<Heart[]>([]);
  const idCounter = useRef(0);
  
  // Get actions from store
  const triggerHeart = useHeartStore(state => state.triggerHeart);
  const incomingHeart = useHeartStore(state => state.incomingHeart);

  // Helper to add heart to local state
  const addHeartToState = (heart: Heart) => {
    setHearts((prev) => [...prev, heart]);

    // Remove heart after animation
    setTimeout(() => {
      setHearts((prev) => prev.filter((h) => h.id !== heart.id));
    }, 2000);
  };

  // Listen for local clicks
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      // 随机生成粉色系的颜色
      const colors = ['#ff69b4', '#ff1493', '#ffc0cb', '#db7093', '#e75480'];
      const color = colors[Math.floor(Math.random() * colors.length)];
      
      // 随机生成 -60 到 60 的横向偏移量
      const tx = Math.floor(Math.random() * 121) - 60;
      
      // Calculate relative coordinates
      const x = e.clientX / window.innerWidth;
      const y = e.clientY / window.innerHeight;

      const newHeart: Heart = {
        id: idCounter.current++,
        x, // relative
        y, // relative
        color,
        tx,
      };

      // Add to local state (for immediate feedback)
      addHeartToState(newHeart);
      
      // Trigger update to store (to be sent to peer)
      triggerHeart(newHeart);
    };

    window.addEventListener('click', handleClick);

    return () => {
      window.removeEventListener('click', handleClick);
    };
  }, [triggerHeart]);

  // Listen for incoming hearts from store
  useEffect(() => {
    if (incomingHeart) {
      // Use a unique ID for incoming hearts to avoid collision
      const newHeart: Heart = {
        ...incomingHeart,
        id: idCounter.current++,
      };
      addHeartToState(newHeart);
    }
  }, [incomingHeart]);

  return (
    <div style={{ 
      position: 'fixed', 
      top: 0, 
      left: 0, 
      width: '100%', 
      height: '100%', 
      pointerEvents: 'none', 
      zIndex: 9999,
      overflow: 'hidden'
    }}>
      {hearts.map((heart) => (
        <span
          key={heart.id}
          style={{
            position: 'absolute',
            // Convert relative coordinates back to pixels
            left: `${heart.x * 100}%`,
            top: `${heart.y * 100}%`,
            color: heart.color,
            fontSize: '72px', // 大3倍
            transform: 'translate(-50%, -50%)',
            animation: 'floatUp 2s ease-out forwards',
            userSelect: 'none',
            pointerEvents: 'none',
            // @ts-ignore: Custom CSS variable
            '--tx': `${heart.tx}px`,
          } as React.CSSProperties}
        >
          ❤
        </span>
      ))}
    </div>
  );
};

export default ClickHeart;
