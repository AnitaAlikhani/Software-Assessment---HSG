import { createRoot } from 'react-dom/client';
import LiveCall from './LiveCall.tsx';
import '../../index.css';

// The live call is a page of its own (voice-call.html). Nothing in the app links to it.
createRoot(document.getElementById('root')!).render(<LiveCall />);
