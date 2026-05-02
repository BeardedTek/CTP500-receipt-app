import { BrowserRouter, Route, Routes } from 'react-router-dom';
import ReceiptPage from './pages/ReceiptPage';
import PrinterDiscoveryPage from './pages/PrinterDiscoveryPage';

function routerBasename(): string | undefined {
  const base = import.meta.env.BASE_URL;
  if (base === '/' || base === '') return undefined;
  return base.endsWith('/') ? base.slice(0, -1) : base;
}

export default function App() {
  return (
    <BrowserRouter basename={routerBasename()}>
      <Routes>
        <Route path="/" element={<ReceiptPage />} />
        <Route path="/printer-setup" element={<PrinterDiscoveryPage />} />
      </Routes>
    </BrowserRouter>
  );
}
