import React,{useEffect,useId,useMemo,useRef,useState} from 'react';

/** Nombre: roomPath. Razón: diferenciar salas homónimas. Entradas: sala autorizada.
 * Salida: ruta legible. Efectos: ninguno. */
export function roomPath(room){return [room.sectorNombre,room.edificioNombre,room.pisoNombre,room.nombre].filter(Boolean).join(' › ')}

/** Nombre: HistoryRoomPicker. Razón: buscar y elegir sala en un único campo.
 * Entradas: salas autorizadas, valor y cambio. Salida: selector con teclado. Efectos: cambia sala local. */
export default function HistoryRoomPicker({rooms,value,onChange,disabled}){
 const [open,setOpen]=useState(false),[query,setQuery]=useState(''),[active,setActive]=useState(-1);
 const root=useRef(null),input=useRef(null),id=useId();
 const selected=rooms.find(r=>r.id===value);
 const matches=useMemo(()=>{const text=query.trim().toLocaleLowerCase('es').normalize('NFD').replace(/[\u0300-\u036f]/g,'');return rooms.filter(r=>roomPath(r).toLocaleLowerCase('es').normalize('NFD').replace(/[\u0300-\u036f]/g,'').includes(text))},[rooms,query]);
 const visible=matches.slice(0,50);
 useEffect(()=>{if(open&&active>=0)document.getElementById(id+'-'+active)?.scrollIntoView({block:'nearest'})},[active,open,id]);
 useEffect(()=>{const outside=e=>{if(!root.current?.contains(e.target))setOpen(false)};document.addEventListener('pointerdown',outside);return()=>document.removeEventListener('pointerdown',outside)},[]);
 /** Nombre: choose. Razón: aceptar sólo registros autorizados del listado. Entradas: sala.
  * Salida: selección confirmada y lista cerrada. Efectos: callback local. */
 function choose(room){onChange(room.id);setOpen(false);setQuery('');setActive(-1);input.current?.focus()}
 /** Nombre: keyboard. Razón: recorrer opciones sin ratón. Entradas: tecla.
  * Salida: foco activo, selección o cierre. Efectos: estado de interfaz. */
 function keyboard(e){
  if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();setOpen(true);setActive(index=>e.key==='ArrowDown'?Math.min(index+1,visible.length-1):Math.max(index-1,0))}
  if(e.key==='Enter'&&open){e.preventDefault();if(active>=0&&visible[active])choose(visible[active]);else if(visible.length===1)choose(visible[0])}
  if(e.key==='Escape'&&open){e.preventDefault();setOpen(false);setQuery('');setActive(-1)}
 }
 return <div className="historyRoomPicker" ref={root} onBlur={e=>{if(!e.currentTarget.contains(e.relatedTarget))setOpen(false)}}><label htmlFor={id}>Sala</label><div className="historyRoomInput"><input id={id} ref={input} role="combobox" aria-expanded={open} aria-controls={id+'-list'} aria-autocomplete="list" aria-activedescendant={open&&active>=0?id+'-'+active:undefined} disabled={disabled} value={open?query:selected?.nombre||''} onFocus={()=>{setOpen(true);setQuery('');setActive(-1)}} onChange={e=>{setQuery(e.target.value);setOpen(true);setActive(-1)}} onKeyDown={keyboard} placeholder={disabled?'Cargando salas…':'Busca por sala, edificio o sector…'}/><button type="button" disabled={disabled} aria-label={open?'Cerrar opciones de sala':'Abrir opciones de sala'} onClick={()=>{if(open)setOpen(false);else{setQuery('');setActive(-1);setOpen(true);input.current?.focus()}}} tabIndex={-1}>⌄</button></div>{selected&&<small>{[selected.sectorNombre,selected.edificioNombre,selected.pisoNombre].filter(Boolean).join(' › ')}</small>}{open&&<div className="historyRoomOptions"><ul id={id+'-list'} role="listbox" aria-label="Salas disponibles">{visible.map((room,index)=><li key={room.id} id={id+'-'+index} role="option" aria-selected={room.id===value} className={active===index?'active':''} onMouseDown={e=>e.preventDefault()} onClick={()=>choose(room)}><b>{room.nombre}</b><small>{[room.sectorNombre,room.edificioNombre,room.pisoNombre].filter(Boolean).join(' › ')}</small></li>)}</ul>{!matches.length&&<p>No hay salas con ese nombre.</p>}{matches.length>50&&<p>Mostrando 50 de {matches.length}. Escribe para acotar.</p>}</div>}</div>;
}
