import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Home from './pages/Home';
import CallPage from './pages/CallPage';
import ClickHeart from './components/ClickHeart';

function App() {
  const basename = import.meta.env.BASE_URL === '/' ? '' : import.meta.env.BASE_URL;

  return (
    <BrowserRouter basename={basename}>
      <ClickHeart />
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/call/:remotePeerId?" element={<CallPage />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
