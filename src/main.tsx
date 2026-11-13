import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';

// No StrictMode: the game engine owns a single WebGL context and pointer-lock state.
createRoot(document.getElementById('root')!).render(<App />);
