import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, Filler, Tooltip, Legend } from 'chart.js';
import '@fontsource/manrope/latin-400.css'; import '@fontsource/manrope/latin-500.css'; import '@fontsource/manrope/latin-600.css'; import '@fontsource/manrope/latin-700.css';
import App from './ui.jsx'; import './style.css';
ChartJS.register(CategoryScale,LinearScale,PointElement,LineElement,Filler,Tooltip,Legend);
createRoot(document.getElementById('root')).render(<React.StrictMode><BrowserRouter><App/></BrowserRouter></React.StrictMode>);

import './penpot.css';
