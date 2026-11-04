import { createRoot } from 'react-dom/client';
import './theme/tokens.css';
import { Root } from './app/Root.js';

const root = document.getElementById('root');
if (root) createRoot(root).render(<Root />);
