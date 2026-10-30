import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import '@fontsource/manrope/latin-400.css'; import '@fontsource/manrope/latin-500.css'; import '@fontsource/manrope/latin-600.css'; import '@fontsource/manrope/latin-700.css';
import App from './ui.jsx'; import './style.css';
createRoot(document.getElementById('root')).render(<React.StrictMode><BrowserRouter><App/></BrowserRouter></React.StrictMode>);

import './penpot.css';
