import { Navigate, Route, Routes } from 'react-router';
import { AppShell } from './layout/AppShell';
import { ResumenPage } from './features/resumen/ResumenPage';
import { ComprasPage } from './features/compras/ComprasPage';
import { OrderPage } from './features/compras/OrderPage';
import { InventarioPage } from './features/inventario/InventarioPage';
import { VentasPage } from './features/ventas/VentasPage';
import { FacturasPage } from './features/facturas/FacturasPage';
import { InvoicePage } from './features/facturas/InvoicePage';
import { IntegracionesPage } from './features/integraciones/IntegracionesPage';
import { ActividadPage } from './features/actividad/ActividadPage';
import { EmptyState } from './ui/primitives';

export function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<Navigate to="/resumen" replace />} />
        <Route path="resumen" element={<ResumenPage />} />
        <Route path="compras" element={<ComprasPage />} />
        <Route path="compras/pedidos/:id" element={<OrderPage />} />
        <Route path="inventario" element={<InventarioPage />} />
        <Route path="ventas" element={<VentasPage />} />
        <Route path="facturas" element={<FacturasPage />} />
        <Route path="facturas/pagos" element={<FacturasPage />} />
        <Route path="facturas/:id" element={<InvoicePage />} />
        <Route path="integraciones" element={<IntegracionesPage />} />
        <Route path="actividad" element={<ActividadPage />} />
        <Route path="*" element={<EmptyState title="Página no encontrada">La dirección no corresponde a ninguna sección de la plataforma.</EmptyState>} />
      </Route>
    </Routes>
  );
}
