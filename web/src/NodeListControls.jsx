import React from 'react';

/** Nombre: filterNodes. Razón: localizar dispositivos sin renderizar el inventario completo.
 * Entradas: nodos y filtros del usuario. Salida: coincidencias. Efectos: ninguno. */
export function filterNodes(nodes,query,state,room){
 const text=query.trim().toLocaleLowerCase('es');
 return nodes.filter(n=>(!state||n.estado===state)&&(!room||(room==='unassigned'?!n.salaId:n.salaId===room))&&[n.nombre,n.id,n.macAddress,n.salaNombre,n.edificioNombre,n.sectorNombre].filter(Boolean).join(' ').toLocaleLowerCase('es').includes(text));
}

/** Nombre: NodeListControls. Razón: compartir búsqueda y filtros entre las dos vistas de nodos.
 * Entradas: filtros y callbacks del componente padre. Salida: controles accesibles. Efectos: actualiza filtros. */
export default function NodeListControls({query,state,room,onQuery,onState,onRoom,rooms}){
 return <div className="nodeFilters"><label>Buscar nodo<input type="search" value={query} onChange={e=>onQuery(e.target.value)} placeholder="Nombre, ID, MAC o ubicación"/></label><label>Conexión<select value={state} onChange={e=>onState(e.target.value)}><option value="">Todos</option><option value="conectado">Conectados</option><option value="desconectado">Desconectados</option></select></label><label>Ubicación<select value={room} onChange={e=>onRoom(e.target.value)}><option value="">Todas las salas</option><option value="unassigned">Sin asignar</option>{rooms.map(r=><option key={r.id} value={r.id}>{[r.sectorNombre,r.edificioNombre,r.pisoNombre,r.nombre].filter(Boolean).join(' › ')}</option>)}</select></label></div>;
}

/** Nombre: NodePages. Razón: limitar la cantidad de filas visibles. Entradas: página y total.
 * Salida: contador y navegación. Efectos: cambia página en el padre. */
export function NodePages({page,total,onPage}){
 const pages=Math.max(1,Math.ceil(total/20)),current=Math.min(page,pages);
 return <nav className="nodePages" aria-label="Páginas de nodos"><span role="status">{total} resultados · página {current} de {pages}</span>{pages>1&&<><button className="secondary compact" disabled={current===1} onClick={()=>onPage(current-1)}>Anterior</button><button className="secondary compact" disabled={current===pages} onClick={()=>onPage(current+1)}>Siguiente</button></>}</nav>;
}
