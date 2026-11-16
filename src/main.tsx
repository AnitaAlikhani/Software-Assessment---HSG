import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import CustomerChat from './CustomerChat.tsx';
import './index.css';

// "?chat=1" opens the customer side of the live test chat instead of the owner dashboard.
const customerChat = new URLSearchParams(window.location.search).get('chat') === '1';

createRoot(document.getElementById('root')!).render(customerChat ? <CustomerChat /> : <App />);
