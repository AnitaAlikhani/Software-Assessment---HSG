import { createRoot } from 'react-dom/client';
import VoiceLab from './VoiceLab.tsx';
import '../../index.css';

// The voice check is a page of its own (voice-lab.html). Nothing in the app links to it.
createRoot(document.getElementById('root')!).render(<VoiceLab />);
