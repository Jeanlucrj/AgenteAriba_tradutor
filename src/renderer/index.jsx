import ReactDOM from 'react-dom/client';
import App from './App';
import History from './History';
import BrainManager from './BrainManager';
import './index.css';

const hash = window.location.hash;
const component = hash.includes('history') ? <History />
  : hash.includes('brain') ? <BrainManager />
  : <App />;

ReactDOM.createRoot(document.getElementById('root')).render(component);
