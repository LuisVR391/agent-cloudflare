-- Migración 0008: retira la marca de lectura por conversación.
-- El producto dejó de emitir acuses de lectura hacia el canal: en cuentas de
-- coexistencia la app de WhatsApp Business del cliente conserva el estado de
-- lectura y el proveedor no lo sobrescribe, por lo que la columna quedaba sin
-- dueño y podía leerse como una capacidad viva.
-- La migración `0007` no se edita ni se borra porque ya fue aplicada.
-- Reintroducir la marca, si se opera un número exclusivo de Cloud API, es una
-- migración aditiva equivalente a `0007`.

ALTER TABLE conversations DROP COLUMN last_read_at;
