import { useEffect, useState, useRef } from 'react';

interface Heart {
  id: number;
  x: number;
  y: number;
  color: string;
  tx: number; // 随机横向位移
}

const ClickHeart = () => {
  const [hearts, setHearts] = useState<Heart[]>([]);
  const idCounter = useRef(0);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      // 随机生成粉色系的颜色
      const colors = ['#ff69b4', '#ff1493', '#ffc0cb', '#db7093', '#e75480'];
      const color = colors[Math.floor(Math.random() * colors.length)];
      
      // 随机生成 -60 到 60 的横向偏移量
      const tx = Math.floor(Math.random() * 121) - 60;

      const newHeart: Heart = {
        id: idCounter.current++,
        x: e.clientX,
        y: e.clientY,
        color: color,
        tx: tx,
      };

      setHearts((prev) => [...prev, newHeart]);

      // 动画结束后移除爱心
      setTimeout(() => {
        setHearts((prev) => prev.filter((h) => h.id !== newHeart.id));
      }, 2000);
    };

    window.addEventListener('click', handleClick);

    return () => {
      window.removeEventListener('click', handleClick);
    };
  }, []);

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
            left: heart.x,
            top: heart.y,
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
