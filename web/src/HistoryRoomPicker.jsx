import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { api } from './services';

/** Nombre: roomPath. Razón: diferenciar salas homónimas. Entradas: sala autorizada.
 * Salida: ruta legible. Efectos: ninguno. */
export function roomPath(room) {
  return [room.sectorNombre, room.edificioNombre, room.pisoNombre, room.nombre].filter(Boolean).join(' › ');
}

/** Nombre: normalized. Razón: buscar nombres locales sin depender de tildes.
 * Entradas: texto de sala o búsqueda. Salida: texto comparable. Efectos: ninguno. */
function normalized(value) {
  return String(value || '').toLocaleLowerCase('es').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/** Nombre: LocationFilter. Razón: acotar una lista de ubicaciones al escribir.
 * Entradas: etiqueta, opciones, valor y callback. Salida: selector con búsqueda. Efectos: cambia el filtro elegido. */
function LocationFilter({
  label,
  options,
  value,
  disabled,
  onChange
}) {
  const [open, setOpen] = useState(false),
    [query, setQuery] = useState('');
  const root = useRef(null),
    search = useRef(null),
    id = useId();
  useEffect(() => {
    const close = e => {
      if (!root.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, []);
  useEffect(() => {
    if (open) search.current?.focus();
  }, [open]);
  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);
  const matches = options.filter(([, name]) => normalized(name).includes(normalized(query)));
  /** Nombre: choose. Razón: aplicar una ubicación. Entradas: identificador. Salida: filtro actualizado. Efectos: actualiza estado local y foco. */
  function choose(next) {
    onChange(next);
    setOpen(false);
    setQuery('');
    root.current?.querySelector('button')?.focus();
  }
  const selectedName = options.find(([key]) => key === value)?.[1] || 'Todos';
  return (
    <div className="historyLocationFilter" ref={root} onBlur={e => {
      if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false);
    }} onKeyDown={e => {
      if (e.key === 'Escape' && open) {
        e.preventDefault();
        setOpen(false);
        root.current?.querySelector('button')?.focus();
      }
    }}>
      <label id={id}>{label}</label>
      <button type="button" className="historyLocationButton" disabled={disabled}
        aria-label={`${label}: ${selectedName}`} aria-expanded={open} onClick={() => {
          setQuery('');
          setOpen(!open);
        }}>
        <span>{selectedName}</span><span aria-hidden="true">⌄</span>
      </button>
      {open && <div className="historyLocationOptions">
        <input ref={search} type="search" value={query} onKeyDown={e => {
          if (e.key === 'Enter') e.preventDefault();
        }} onChange={e => setQuery(e.target.value)}
          placeholder={`Buscar ${label.toLocaleLowerCase('es')}…`}
          aria-label={`Buscar ${label.toLocaleLowerCase('es')}`} />
        <div className="historyLocationList">
          <button type="button" onMouseDown={e => e.preventDefault()} onClick={() => choose('')}>Todos</button>
          {matches.slice(0, 50).map(([key, name]) => <button type="button" key={key}
            aria-current={value === key ? 'true' : undefined}
            onMouseDown={e => e.preventDefault()} onClick={() => choose(key)}>{name}</button>)}
          {!matches.length && <p>No hay coincidencias.</p>}
        </div>
        {matches.length > 50 && <small>Mostrando 50 de {matches.length}. Escribe para acotar.</small>}
      </div>}
    </div>
  );
}

/** Nombre: HistoryRoomPicker. Razón: localizar una sala por ubicación o por nombre de nodo.
 * Entradas: salas autorizadas, sala elegida y cambio. Salida: filtros encadenados y búsqueda acotada.
 * Efectos: consulta de búsqueda de solo lectura y cambio local de sala. */
export default function HistoryRoomPicker({
  rooms,
  value,
  onChange,
  onScopeChange,
  context = 'historico',
  disabled,
  children
}) {
  const [sector, setSector] = useState(''),
    [building, setBuilding] = useState(''),
    [floor, setFloor] = useState('');
  const [open, setOpen] = useState(false),
    [query, setQuery] = useState(''),
    [active, setActive] = useState(-1);
  const [remote, setRemote] = useState({
      status: 'idle',
      query: '',
      rooms: []
    }),
    [retry, setRetry] = useState(0);
  const root = useRef(null),
    input = useRef(null),
    id = useId();
  const selected = rooms.find(room => room.id === value);
  const sectors = useMemo(() => [...new Map(rooms.map(room => [room.sectorId, room.sectorNombre])).entries()].sort((a, b) => a[1].localeCompare(b[1], 'es')), [rooms]);
  const buildings = useMemo(() => [...new Map(rooms.filter(room => room.sectorId === sector).map(room => [room.edificioId, room.edificioNombre])).entries()].sort((a, b) => a[1].localeCompare(b[1], 'es')), [rooms, sector]);
  const floors = useMemo(() => [...new Map(rooms.filter(room => room.edificioId === building).map(room => [room.pisoId, room.pisoNombre])).entries()].sort((a, b) => a[1].localeCompare(b[1], 'es', {
    numeric: true
  })), [rooms, building]);
  const scoped = useMemo(() => rooms.filter(room => (!sector || room.sectorId === sector) && (!building || room.edificioId === building) && (!floor || room.pisoId === floor)), [rooms, sector, building, floor]);
  const term = query.trim(),
    local = useMemo(() => scoped.filter(room => roomPath(room).split(' › ').some(part => normalized(part).includes(normalized(term)))), [scoped, term]);
  const remoteRooms = remote.query === term && remote.status === 'ready' ? remote.rooms : [];
  const visible = term.length >= 2 ? [...new Map([...remoteRooms, ...local].map(room => [room.id, room])).values()].slice(0, 30) : local.slice(0, 30);
  useEffect(() => {
    if (selected) {
      setSector(selected.sectorId);
      setBuilding(selected.edificioId);
      setFloor(selected.pisoId);
    }
  }, [selected?.id, selected?.sectorId, selected?.edificioId, selected?.pisoId]);
  useEffect(() => {
    if (!open || term.length < 2) return;
    let active = true;
    const timer = setTimeout(() => {
      setRemote({
        status: 'loading',
        query: term,
        rooms: []
      });
      api.historyRooms(term, {
        sectorId: sector || undefined,
        edificioId: building || undefined,
        pisoId: floor || undefined
      }).then(data => {
        if (active) setRemote({
          status: 'ready',
          query: term,
          rooms: data
        });
      }).catch(() => {
        if (active) setRemote({
          status: 'error',
          query: term,
          rooms: []
        });
      });
    }, 250);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [open, term, sector, building, floor, retry]);
  useEffect(() => {
    if (open && active >= 0) document.getElementById(id + '-' + active)?.scrollIntoView({
      block: 'nearest'
    });
  }, [active, open, id]);
  useEffect(() => {
    const outside = event => {
      if (!root.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, []);
  /** Nombre: choose. Razón: elegir una sala sin convertir el nodo en filtro de telemetría.
   * Entradas: sala autorizada. Salida: selección confirmada. Efectos: actualiza filtros locales. */
  function choose(room) {
    setSector(room.sectorId);
    setBuilding(room.edificioId);
    setFloor(room.pisoId);
    onChange(room.id, room);
    setOpen(false);
    setQuery('');
    setActive(-1);
    input.current?.focus();
  }
  /** Nombre: changeScope. Razón: limpiar selecciones hijas al cambiar ubicación.
   * Entradas: nivel y valor elegido. Salida: ámbito local actualizado. Efectos: deselecciona la sala. */
  function changeScope(level, next) {
    const scope = level === 'sector' ? { sectorId: next, edificioId: '', pisoId: '' } :
      level === 'building' ? { sectorId: sector, edificioId: next, pisoId: '' } :
      { sectorId: sector, edificioId: building, pisoId: next };
    if (level === 'sector') {
      setSector(next);
      setBuilding('');
      setFloor('');
    } else if (level === 'building') {
      setBuilding(next);
      setFloor('');
    } else setFloor(next);
    onChange('');
    onScopeChange?.(scope);
    setQuery('');
    setRemote({
      status: 'idle',
      query: '',
      rooms: []
    });
    setOpen(false);
    setActive(-1);
  }
  /** Nombre: keyboard. Razón: recorrer resultados con teclado sin enviar el formulario.
   * Entradas: tecla. Salida: foco y selección. Efectos: estado local del selector. */
  function keyboard(event) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      setOpen(true);
      setActive(index => event.key === 'ArrowDown' ? Math.min(index + 1, visible.length - 1) : Math.max(index - 1, 0));
    }
    if (event.key === 'Enter' && open) {
      event.preventDefault();
      if (active >= 0 && visible[active]) choose(visible[active]);else if (visible.length) choose(visible[0]);
    }
    if (event.key === 'Escape' && open) {
      event.preventDefault();
      setOpen(false);
      setQuery('');
      setActive(-1);
    }
  }
  return <div className="historyRoomPicker" ref={root} onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
  }}>
   <div className="historyLocation">
     <LocationFilter label="Sector" options={sectors} value={sector} disabled={disabled} onChange={next => changeScope('sector', next)} />
     <LocationFilter label="Edificio" options={buildings} value={building} disabled={disabled || !sector} onChange={next => changeScope('building', next)} />
     <LocationFilter label="Piso" options={floors} value={floor} disabled={disabled || !building} onChange={next => changeScope('floor', next)} />
   </div>
   <div className="historyPickerRow"><div className="historyRoomField"><label htmlFor={id}>Sala o nodo</label>
   <div className="historyRoomInput"><input id={id} ref={input} autoComplete="off" role="combobox" aria-expanded={open} aria-controls={id + '-list'} aria-autocomplete="list" aria-activedescendant={open && active >= 0 ? id + '-' + active : undefined} disabled={disabled} value={open ? query : selected?.nombre || ''} onFocus={() => {
            setOpen(true);
            setQuery('');
            setActive(-1);
          }} onChange={event => {
            setQuery(event.target.value);
            setOpen(true);
            setActive(-1);
          }} onKeyDown={keyboard} placeholder={disabled ? 'Cargando salas…' : 'Buscar sala, nodo o ubicación…'} /><button type="button" disabled={disabled} aria-label={open ? 'Cerrar opciones de sala' : 'Abrir opciones de sala'} onClick={() => {
            if (open) setOpen(false);else {
              setQuery('');
              setActive(-1);
              setOpen(true);
              input.current?.focus();
            }
          }} tabIndex={-1}>⌄</button></div>
   <small>{selected ? `${roomPath(selected)}${context === 'historico' ? ' · Histórico completo de la sala' : ''}` : 'Escribe para buscar una sala o dos caracteres para localizarla por nodo.'}</small>
   {open && <div className="historyRoomOptions"><ul id={id + '-list'} role="listbox" aria-label="Salas disponibles">{visible.map((room, index) => <li key={room.id} id={id + '-' + index} role="option" aria-selected={room.id === value} className={active === index ? 'active' : ''} onMouseDown={event => event.preventDefault()} onClick={() => choose(room)}><b>{room.nombre}</b><small>{[room.sectorNombre, room.edificioNombre, room.pisoNombre].filter(Boolean).join(' › ')}</small></li>)}</ul>
     {term.length >= 2 && remote.status === 'loading' && remote.query === term && <p role="status">Buscando salas…</p>}
     {term.length >= 2 && remote.status === 'error' && remote.query === term && <p role="alert">No se pudo buscar. <button type="button" onClick={() => setRetry(value => value + 1)}>Reintentar</button></p>}
     {!visible.length && term.length < 2 && <p>No hay salas en esta ubicación.</p>}
     {!visible.length && term.length >= 2 && remote.status === 'ready' && remote.query === term && <p>No se encontraron salas. Prueba con otro nombre.</p>}
     {term.length < 2 && local.length > 30 && <p>Mostrando 30 de {local.length}. Escribe para acotar.</p>}
     {term.length >= 2 && remote.status === 'ready' && remote.query === term && remote.rooms.length === 30 && <p>Mostrando los primeros 30 resultados. Escribe más para acotar.</p>}
   </div>}</div>{children}</div>
 </div>;
}
