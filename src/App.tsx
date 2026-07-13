import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Home from './pages/Home';
import ClickHeart from './components/ClickHeart';

const CallPage = lazy(() => import('./pages/CallPage'));

function App() {
  const basename = import.meta.env.BASE_URL === '/' ? '' : import.meta.env.BASE_URL;

  return (
    <BrowserRouter basename={basename}>
      <ClickHeart />
      <Routes>
        <Route path="/" element={<Home />} />
        <Route
          path="/call/:remotePeerId?"
          element={(
            <Suspense fallback={<div className="min-h-screen bg-gray-900" aria-label="正在加载通话" />}>
              <CallPage />
            </Suspense>
          )}
        />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
