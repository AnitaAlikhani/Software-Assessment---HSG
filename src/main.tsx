import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import CustomerChat from './CustomerChat.tsx';
import { ErrorBoundary } from './components/ErrorScreen.tsx';
import { takeKeyFromAddress } from './liveWhatsApp.ts';
import { resetDemoState } from './useDemoState.ts';
import './index.css';

// Any "chat" parameter ("/?chat=<token>") opens the customer's side of the salon chat instead of
// the owner dashboard. It is a page of its own: nothing on it leads into the dashboard.
const customerChat = new URLSearchParams(window.location.search).has('chat');

// No page keeps an owner key in its address: the owner's app stores it and removes it; a
// customer's page (chat or booking, e.g. an old link "?chat=1&live=…") removes it and keeps nothing.
takeKeyFromAddress();

// One bad value must not leave a blank page: what fails while a page is drawn ends on a screen
// with "Reload" and "Reset data". The customer chat keeps nothing of the salon in this browser,
// so it has nothing to reset.
createRoot(document.getElementById('root')!).render(customerChat
  ? <ErrorBoundary><CustomerChat /></ErrorBoundary>
  : <ErrorBoundary resetData={resetDemoState}><App /></ErrorBoundary>);
