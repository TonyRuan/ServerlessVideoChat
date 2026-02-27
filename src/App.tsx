import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Home from './pages/Home';
import CallPage from './pages/CallPage';

function App() {
  return (
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/call/:remotePeerId?" element={<CallPage />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
