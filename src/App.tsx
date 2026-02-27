import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Home from './pages/Home';
import CallPage from './pages/CallPage';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/call/:remotePeerId?" element={<CallPage />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
