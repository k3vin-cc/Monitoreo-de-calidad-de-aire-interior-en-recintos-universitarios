import React, { useEffect, useMemo, useRef, useState } from 'react';
import { api } from './services';

/** Nombre: TelegramPage. Razón: administrar el vínculo, las suscripciones y sus pausas.
 * Entradas: ninguna; la API identifica al usuario por su sesión. Salida: panel personal de Telegram.
 * Efectos: consulta preferencias y salas autorizadas; guarda cambios y envía pruebas bajo acción explícita.
 */
export default function TelegramPage() {
  const [prefs, setPrefs] = useState(null);
  const [rooms, setRooms] = useState([]);
  const [enabled, setEnabled] = useState(false);
  const [selected, setSelected] = useState([]);
  const [code, setCode] = useState(null);
  const [codeExpired, setCodeExpired] = useState(false);
  const [pending, setPending] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [sector, setSector] = useState('');
  const [building, setBuilding] = useState('');
  const [floor, setFloor] = useState('');
  const [savedOnly, setSavedOnly] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [reloadConfirm, setReloadConfirm] = useState(false);
  const [unlinkConfirm, setUnlinkConfirm] = useState(false);
  const [deliveries, setDeliveries] = useState(null);
  const [deliveryPage, setDeliveryPage] = useState(1);
  const [historyLoading, setHistoryLoading] = useState(false);
  const lock = useRef(false);
  const revision = useRef(0);
  const historyRevision = useRef(0);
  const refreshLinkRef = useRef(null);

  const savedIds = useMemo(() => new Set(prefs?.salas || []), [prefs?.salas]);
  const selectedIds = useMemo(() => new Set(selected), [selected]);
  const sectors = useMemo(() => [...new Map(rooms.map(room => [room.sectorId,
    { id: room.sectorId, nombre: room.sectorNombre }])).values()], [rooms]);
  const buildings = useMemo(() => [...new Map(rooms
    .filter(room => !sector || room.sectorId === sector)
    .map(room => [room.edificioId, { id: room.edificioId,
      nombre: [room.sectorNombre, room.edificioNombre].filter(Boolean).join(' › ') }])).values()], [rooms, sector]);
  const floors = useMemo(() => [...new Map(rooms
    .filter(room => (!sector || room.sectorId === sector) && (!building || room.edificioId === building))
    .map(room => [room.pisoId, { id: room.pisoId,
      nombre: [room.edificioNombre, room.pisoNombre].filter(Boolean).join(' › ') }])).values()], [rooms, sector, building]);
  const dirty = Boolean(prefs && (enabled !== Boolean(prefs.vinculo?.avisosActivos)
    || [...selected].sort().join('|') !== [...prefs.salas].sort().join('|')));
  const linked = Boolean(prefs?.vinculo?.chatVinculado);
  const matches = useMemo(() => rooms
    .filter(room => (!sector || room.sectorId === sector)
      && (!building || room.edificioId === building)
      && (!floor || room.pisoId === floor)
      && (!savedOnly || savedIds.has(room.id)))
    .filter(room => [room.nombre, room.sectorNombre, room.edificioNombre, room.pisoNombre]
      .filter(Boolean).join(' ').toLocaleLowerCase('es')
      .includes(query.trim().toLocaleLowerCase('es'))),
  [rooms, sector, building, floor, savedOnly, savedIds, query]);
  const pageSize = 20;
  const pages = Math.max(1, Math.ceil(matches.length / pageSize));
  const currentPage = Math.min(page, pages);
  const pageRooms = matches.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const pageGroups = useMemo(() => {
    const groups = new Map();
    pageRooms.forEach(room => {
      const key = room.edificioId || 'sin-edificio';
      if (!groups.has(key)) groups.set(key, { nombre: room.edificioNombre || 'Sin edificio', salas: [] });
      groups.get(key).salas.push(room);
    });
    return [...groups.entries()];
  }, [pageRooms]);
  const activeCode = Boolean(code && !codeExpired);

  /** Nombre: load. Razón: cargar la configuración y salas permitidas en paralelo.
   * Entradas: ninguna. Salida: preferencias y lista autorizada. Efectos: dos consultas de solo lectura.
   */
  async function load() {
    if (lock.current) return;
    const version = ++revision.current;
    try {
      const [preferences, availableRooms] = await Promise.all([api.telegramPrefs(), api.rooms({})]);
      if (version !== revision.current) return;
      setConflict(false);
      setReloadConfirm(false);
      setPrefs(preferences);
      setRooms(availableRooms);
      setEnabled(Boolean(preferences.vinculo?.avisosActivos));
      setSelected(preferences.salas);
      setError('');
    } catch (loadError) {
      setError(loadError.message);
    }
  }

  useEffect(() => { load(); }, []);

  /** Nombre: refreshLink. Razón: comprobar el vínculo sin reemplazar la edición local de salas.
   * Entradas: ninguna. Salida: estado actualizado del vínculo. Efectos: consulta preferencias personales.
   */
  async function refreshLink(manual = false) {
    if (lock.current) return;
    const version = ++revision.current;
    try {
      const preferences = await api.telegramPrefs();
      if (version !== revision.current || lock.current) return;
      setPrefs(current => current ? { ...current, vinculo: preferences.vinculo } : preferences);
      if (preferences.vinculo?.chatVinculado) {
        setCode(null);
        setMessage('Cuenta vinculada. Elige las salas y guarda para activar los avisos.');
      } else if (manual) {
        setMessage('Telegram aún no confirmó el vínculo. Envía el comando al bot y vuelve a comprobar.');
      }
      setError('');
    } catch (refreshError) {
      setError(refreshError.message);
    }
  }

  refreshLinkRef.current = refreshLink;

  useEffect(() => {
    if (!activeCode || pending) return undefined;
    const checkLink = window.setInterval(() => refreshLinkRef.current?.(), 5000);
    return () => window.clearInterval(checkLink);
  }, [activeCode, pending]);

  useEffect(() => {
    if (!message) return undefined;
    const timer = window.setTimeout(() => setMessage(''), 6000);
    return () => window.clearTimeout(timer);
  }, [message]);

  /** Nombre: generate. Razón: pedir código nuevo solo cuando la cuenta está sin vincular.
   * Entradas: acción explícita del usuario. Salida: código temporal y enlace directo opcional.
   * Efectos: crea código de 10 minutos; el servidor conserva intacta una cuenta ya vinculada.
   */
  async function generate() {
    if (lock.current || linked) return;
    lock.current = true;
    revision.current++;
    setPending('code');
    setError('');
    try {
      const result = await api.telegramLink();
      setCode(result);
      setCodeExpired(false);
      setMessage(result.telegramUrl
        ? 'Código listo. Abre el bot y confirma la vinculación.'
        : 'Código listo. El bot no confirmó un enlace directo; copia el comando y envíalo en un chat privado.');
    } catch (requestError) {
      setError(requestError.message);
      if (requestError.status === 409) {
        lock.current = false;
        await refreshLink();
      }
    } finally {
      lock.current = false;
      setPending('');
    }
  }

  /** Nombre: save. Razón: persistir las salas y el interruptor como una sola edición.
   * Entradas: envío del formulario y selección local. Salida: preferencias confirmadas.
   * Efectos: actualiza Telegram y reinicia el historial visible para consultar datos recientes.
   */
  async function save(event) {
    event.preventDefault();
    if (lock.current || selected.length > 1000) return;
    lock.current = true;
    revision.current++;
    historyRevision.current++;
    setPending('save');
    setError('');
    try {
      const preferences = await api.saveTelegram({
        avisosActivos: enabled,
        salas: selected,
        salasBase: prefs.salas,
        avisosBase: Boolean(prefs.vinculo?.avisosActivos)
      });
      setPrefs(preferences);
      setEnabled(Boolean(preferences.vinculo?.avisosActivos));
      setSelected(preferences.salas);
      setConflict(false);
      setDeliveries(null);
      setMessage('Preferencias guardadas.');
    } catch (saveError) {
      if (saveError.status === 409) setConflict(true);
      setError(saveError.message);
    } finally {
      lock.current = false;
      setPending('');
    }
  }

  /** Nombre: loadDeliveries. Razón: consultar historial propio solo al abrirlo o actualizarlo.
   * Entradas: página solicitada. Salida: hasta 20 registros y un indicador de continuidad.
   * Efectos: consulta la API; no confirma lectura ni recepción del mensaje en Telegram.
   */
  async function loadDeliveries(requestedPage) {
    const version = ++historyRevision.current;
    setHistoryLoading(true);
    try {
      const result = await api.telegramDeliveries(requestedPage);
      if (version !== historyRevision.current) return;
      setDeliveries(result);
      setDeliveryPage(requestedPage);
      setError('');
    } catch (historyError) {
      setError(historyError.message);
    } finally {
      if (version === historyRevision.current) setHistoryLoading(false);
    }
  }

  /** Nombre: changeGroup. Razón: seleccionar o quitar un conjunto manteniendo las salas fuera del filtro.
   * Entradas: filas visibles en el ámbito actual y estado deseado. Salida: selección local.
   * Efectos: ninguno persistente; el guardado sigue siendo explícito.
   */
  function changeGroup(rows, checked) {
    const ids = new Set(rows.map(room => room.id));
    setSelected(previous => checked
      ? [...new Set([...previous, ...ids])]
      : previous.filter(id => !ids.has(id)));
  }

  /** Nombre: pauseRooms. Razón: aplicar una pausa inmediata a suscripciones ya guardadas.
   * Entradas: IDs de salas y duración 0, 1 o 24 horas. Salida: pausas actualizadas.
   * Efectos: actualización inmediata, protegida por el servidor; no cambia la selección pendiente.
   */
  async function pauseRooms(ids, hours) {
    const subscribed = [...new Set(ids)].filter(id => savedIds.has(id));
    if (lock.current || !subscribed.length || dirty) return;
    if (subscribed.length > 1000) {
      setError('Selecciona hasta 1000 salas para aplicar una pausa. Usa la búsqueda o los filtros para reducir el grupo.');
      return;
    }
    lock.current = true;
    revision.current++;
    setPending('pause');
    setError('');
    try {
      const preferences = await api.telegramPause({ salas: subscribed, horas: hours });
      setPrefs(preferences);
      setMessage(hours ? `Pausa aplicada a ${subscribed.length} salas guardadas.` : 'Avisos reanudados.');
    } catch (pauseError) {
      if (pauseError.status === 409) setConflict(true);
      setError(pauseError.message);
    } finally {
      lock.current = false;
      setPending('');
    }
  }

  /** Nombre: testMessage. Razón: comprobar el vínculo sin esperar una alerta real.
   * Entradas: acción explícita del usuario con cuenta vinculada. Salida: confirmación de envío.
   * Efectos: solicita el envío de un mensaje genérico; el servidor aplica un intervalo de 30 segundos.
   */
  async function testMessage() {
    if (lock.current) return;
    lock.current = true;
    setPending('test');
    setError('');
    try {
      await api.telegramTest();
      setMessage('Mensaje de prueba enviado. Revisa el chat de Telegram.');
    } catch (testError) {
      setError(testError.message);
    } finally {
      lock.current = false;
      setPending('');
    }
  }

  /** Nombre: unlink. Razón: desvincular con confirmación sin borrar suscripciones históricas.
   * Entradas: acción confirmada. Salida: preferencias sin cuenta activa.
   * Efectos: revoca el chat y deja los avisos desactivados en el servidor.
   */
  async function unlink() {
    if (lock.current) return;
    lock.current = true;
    revision.current++;
    historyRevision.current++;
    setPending('unlink');
    setDeliveries(null);
    try {
      const preferences = await api.telegramUnlink();
      setPrefs(preferences);
      setSelected(preferences.salas);
      setEnabled(false);
      setCode(null);
      setUnlinkConfirm(false);
      setMessage('Cuenta desvinculada. Las suscripciones se conservan y los avisos están desactivados.');
    } catch (unlinkError) {
      setError(unlinkError.message);
    } finally {
      lock.current = false;
      setPending('');
    }
  }

  const pageSelected = pageRooms.length > 0 && pageRooms.every(room => selectedIds.has(room.id));
  const matchedSelected = matches.length > 0 && matches.every(room => selectedIds.has(room.id));
  const warning = enabled && selected.length === 0
    ? 'Los avisos están activados, pero no hay salas seleccionadas.'
    : !enabled
      ? 'Los avisos no se enviarán hasta activar esta opción y guardar.'
      : `Se recibirán avisos de ${selected.length} salas seleccionadas.`;

  return (
    <div className="telegramPage">
      <div className="pageHeading">
        <div>
          <span className="eyebrow">NOTIFICACIONES</span>
          <h1>Telegram</h1>
          <p>Vincula una cuenta y administra las salas que enviarán avisos a ese chat.</p>
        </div>
      </div>

      {error && <div className="notice error" role="alert">
        {error}{!prefs && <button type="button" onClick={load}>Reintentar</button>}
      </div>}
      {message && <div className="notice success" role="status">{message}</div>}

      {!prefs ? <p>Cargando configuración…</p> : (
        <div className="telegramGrid">
          <section className="panel telegramAccountPanel">
            <div className="telegramPanelHeading">
              <div><span className="eyebrow">PASO 1</span><h2>Cuenta de Telegram</h2></div>
              <span className={`badge ${linked ? 'good' : 'muted'}`}>
                {linked ? 'Vinculada' : 'Sin vincular'}
              </span>
            </div>

            {linked ? (
              <div className="telegramAccount">
                <b>{prefs.vinculo.telegramUsername
                  ? `@${prefs.vinculo.telegramUsername}`
                  : `Cuenta terminada en ${prefs.vinculo.cuentaReferencia || '----'}`}</b>
                <span>{prefs.vinculo.vinculadoEn
                  ? `Vinculada el ${new Date(prefs.vinculo.vinculadoEn).toLocaleDateString('es-CL')}`
                  : 'Una cuenta de Telegram vinculada a este usuario'}</span>
                <button type="button" className="secondary" disabled={Boolean(pending)} onClick={testMessage}>
                  {pending === 'test' ? 'Enviando prueba…' : 'Enviar mensaje de prueba'}
                </button>
                <small>La prueba envía un mensaje a esta cuenta; puedes solicitar otra cada 30 segundos.</small>
              </div>
            ) : (
              <>
                <ol className="telegramSteps">
                  <li>Genera un código temporal de un solo uso.</li>
                  <li>Abre el bot institucional y confirma el vínculo.</li>
                  <li>Selecciona salas y activa los avisos en el paso siguiente.</li>
                </ol>
                {code && <div className="linkCode" aria-live="polite">
                  <div><b>{activeCode ? `/start ${code.codigo}` : 'Código vencido'}</b>
                    <span>{activeCode ? <TelegramCodeCountdown expiresAt={code.expiraEn}
                      onExpire={() => setCodeExpired(true)} /> : 'Genera otro código para continuar.'}</span></div>
                  {activeCode && <div className="inlineActions">
                    {code.telegramUrl && <a className="buttonLike primary" href={code.telegramUrl}
                      target="_blank" rel="noopener noreferrer">Abrir en Telegram</a>}
                    <button type="button" className="secondary" onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(`/start ${code.codigo}`);
                        setMessage('Comando copiado.');
                      } catch {
                        setError('No se pudo copiar. Selecciona el comando y cópialo manualmente.');
                      }
                    }}>Copiar comando</button>
                  </div>}
                </div>}
                {!code?.telegramUrl && <p className="telegramHint">
                  Si el enlace no está disponible, copia el comando y envíalo al bot en un chat privado.
                </p>}
                <div className="inlineActions">
                  <button type="button" className="primary" disabled={Boolean(pending)} onClick={generate}>
                    {pending === 'code' ? 'Generando…' : code && codeExpired ? 'Generar otro código' : 'Conectar Telegram'}
                  </button>
                  {code && activeCode && <button type="button" className="secondary"
                    disabled={Boolean(pending)} onClick={() => refreshLink(true)}>Comprobar vínculo</button>}
                </div>
              </>
            )}

            {linked && <div className="telegramUnlink">
              {!unlinkConfirm ? <button type="button" className="textButton"
                disabled={Boolean(pending) || dirty} onClick={() => setUnlinkConfirm(true)}>
                Desvincular cuenta
              </button> : <div className="notice">
                <p>Se revocará el vínculo. Las salas se conservan, pero los avisos se desactivan.</p>
                <div className="inlineActions">
                  <button type="button" onClick={() => setUnlinkConfirm(false)}>Cancelar</button>
                  <button type="button" disabled={Boolean(pending)} onClick={unlink}>Confirmar desvinculación</button>
                </div>
              </div>}
              {dirty && <small>Guarda o cancela los cambios de salas antes de desvincular.</small>}
            </div>}
          </section>

          <section className="panel telegramPreferencesPanel">
            <div className="telegramPanelHeading">
              <div><span className="eyebrow">PASOS 2 Y 3</span><h2>Salas y avisos</h2></div>
              <span className="telegramCount">{selected.length} seleccionadas</span>
            </div>
            <form onSubmit={save} className="stack">
              <label className="toggleRow">
                <span><b>Recibir avisos</b><small>Se aplica al guardar junto con la selección de salas.</small></span>
                <input type="checkbox" disabled={Boolean(pending)} checked={enabled}
                  onChange={event => setEnabled(event.target.checked)} />
              </label>
              <div className={`telegramDeliveryStatus ${enabled && selected.length ? 'active' : ''}`} role="status">
                {warning}
                {!linked && <span>Conecta Telegram antes de recibir notificaciones.</span>}
                <span>Las alertas dependen de eventos confirmados por AIRA; las salas nuevas deben añadirse aquí.</span>
              </div>

              <div className="telegramFilters">
                <label>Buscar sala, edificio o sector
                  <input type="search" value={query} onChange={event => {
                    setQuery(event.target.value); setPage(1);
                  }} placeholder="Escribe un nombre…" />
                </label>
                <label>Sector
                  <select value={sector} onChange={event => {
                    setSector(event.target.value); setBuilding(''); setFloor(''); setPage(1);
                  }}><option value="">Todos los sectores</option>
                    {sectors.map(item => <option key={item.id} value={item.id}>{item.nombre}</option>)}
                  </select>
                </label>
                <label>Edificio
                  <select value={building} onChange={event => {
                    setBuilding(event.target.value); setFloor(''); setPage(1);
                  }}><option value="">Todos los edificios</option>
                    {buildings.map(item => <option key={item.id} value={item.id}>{item.nombre}</option>)}
                  </select>
                </label>
                <label>Piso
                  <select value={floor} onChange={event => {
                    setFloor(event.target.value); setPage(1);
                  }}><option value="">Todos los pisos</option>
                    {floors.map(item => <option key={item.id} value={item.id}>{item.nombre}</option>)}
                  </select>
                </label>
              </div>

              <label className="checkRow telegramSavedFilter">
                <input type="checkbox" checked={savedOnly} onChange={event => {
                  setSavedOnly(event.target.checked); setPage(1);
                }} />Mostrar solo salas suscritas
              </label>

              <div className="telegramSelectionBar">
                <span>{matches.length} salas encontradas · página {currentPage} de {pages}</span>
                <div className="inlineActions">
                  <button type="button" disabled={!pageRooms.length || Boolean(pending)}
                    onClick={() => changeGroup(pageRooms, !pageSelected)}>
                    {pageSelected ? 'Quitar selección de página' : 'Seleccionar página'}
                  </button>
                  {matches.length > pageSize && <button type="button" disabled={Boolean(pending)}
                    onClick={() => changeGroup(matches, !matchedSelected)}>
                    {matchedSelected ? 'Quitar selección encontrada' : `Seleccionar ${matches.length} encontradas`}
                  </button>}
                  <button type="button" disabled={!savedIds.size || Boolean(pending) || dirty}
                    onClick={() => pauseRooms(matches.map(room => room.id), 1)}>Pausar guardadas 1 h</button>
                  <button type="button" disabled={!savedIds.size || Boolean(pending) || dirty}
                    onClick={() => pauseRooms(matches.map(room => room.id), 24)}>Pausar guardadas 24 h</button>
                  <button type="button" disabled={!savedIds.size || Boolean(pending) || dirty}
                    onClick={() => pauseRooms(matches.map(room => room.id), 0)}>Reanudar guardadas</button>
                </div>
              </div>
              <p className="telegramPauseHint">Las pausas se aplican de inmediato y solo a suscripciones ya guardadas. Guarda o cancela los cambios pendientes antes de usar una pausa.</p>

              {selected.length > 1000 && <p className="notice error" role="alert">
                El máximo es 1000 salas por usuario. Quita {selected.length - 1000} antes de guardar.
              </p>}

              <div className="telegramRooms">
                {pageGroups.map(([groupId, group]) => {
                  const allGroupMatches = matches.filter(room => room.edificioId === groupId);
                  const allSelected = allGroupMatches.length > 0
                    && allGroupMatches.every(room => selectedIds.has(room.id));
                  return <section className="telegramBuildingGroup" key={groupId}>
                    <div className="telegramBuildingHeading">
                      <h3>{group.nombre}</h3>
                      <button type="button" disabled={Boolean(pending)}
                        onClick={() => changeGroup(allGroupMatches, !allSelected)}>
                        {allSelected ? 'Quitar edificio' : `Seleccionar edificio (${allGroupMatches.length})`}
                      </button>
                    </div>
                    {group.salas.map(room => {
                      const isSelected = selectedIds.has(room.id);
                      const isSaved = savedIds.has(room.id);
                      const pause = prefs.pausas?.[room.id];
                      const isPaused = pause && Date.parse(pause) > Date.now();
                      return <div className="telegramRoomRow" key={room.id}>
                        <label className="telegramRoomCheck">
                          <input type="checkbox" disabled={Boolean(pending)} checked={isSelected}
                            onChange={event => setSelected(previous => event.target.checked
                              ? [...new Set([...previous, room.id])]
                              : previous.filter(id => id !== room.id))} />
                          <span><b>{room.nombre}</b>
                            <small>{[room.sectorNombre, room.edificioNombre, room.pisoNombre]
                              .filter(Boolean).join(' › ')}</small>
                          </span>
                        </label>
                        <div className="telegramRoomState">
                          <span className={`telegramSubscription ${isSelected ? 'selected' : ''}`}>
                            {isSelected ? (isSaved ? 'Suscrita' : 'Se añadirá al guardar')
                              : (isSaved ? 'Se quitará al guardar' : 'Sin suscripción')}
                          </span>
                          {isPaused && <span className="telegramPaused">Pausada hasta {new Date(pause).toLocaleString('es-CL')}</span>}
                          {isSaved && <details className="telegramRoomActions">
                            <summary>Administrar pausa</summary>
                            <div className="inlineActions">
                              <button type="button" disabled={Boolean(pending) || dirty}
                                onClick={() => pauseRooms([room.id], 1)}>1 hora</button>
                              <button type="button" disabled={Boolean(pending) || dirty}
                                onClick={() => pauseRooms([room.id], 24)}>24 horas</button>
                              <button type="button" disabled={Boolean(pending) || dirty}
                                onClick={() => pauseRooms([room.id], 0)}>Reanudar</button>
                            </div>
                          </details>}
                        </div>
                      </div>;
                    })}
                  </section>;
                })}
              </div>
              {!matches.length && <p className="telegramEmpty">No hay salas que coincidan con esos filtros.</p>}
              {pages > 1 && <div className="inlineActions telegramPagination">
                <button type="button" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>Anterior</button>
                <span>{currentPage} de {pages}</span>
                <button type="button" disabled={currentPage === pages} onClick={() => setPage(currentPage + 1)}>Siguiente</button>
              </div>}

              {conflict && <div className="notice error">
                <p>Otra sesión cambió estas preferencias. Tus cambios locales siguen aquí.</p>
                <button type="button" onClick={() => setReloadConfirm(true)}>Recargar configuración guardada</button>
              </div>}
              {reloadConfirm && <div className="notice">
                <p>Recargar descartará los cambios locales pendientes.</p>
                <div className="inlineActions">
                  <button type="button" onClick={() => setReloadConfirm(false)}>Conservar edición</button>
                  <button type="button" onClick={load}>Descartar y recargar</button>
                </div>
              </div>}

              <div className="telegramSaveBar">
                <p role="status">{dirty ? 'Tienes cambios sin guardar.' : 'Sin cambios pendientes.'}</p>
                {dirty && <button type="button" className="secondary" disabled={Boolean(pending)}
                  onClick={() => {
                    setSelected(prefs.salas);
                    setEnabled(Boolean(prefs.vinculo?.avisosActivos));
                  }}>Cancelar cambios</button>}
                <button className="primary" disabled={Boolean(pending) || !dirty || conflict || selected.length > 1000}>
                  {pending === 'save' ? 'Guardando…' : 'Guardar cambios'}
                </button>
              </div>
            </form>
          </section>

          <section className="panel telegramHistory">
            <details onToggle={event => {
              if (event.currentTarget.open && !deliveries && !historyLoading) loadDeliveries(1);
            }}>
              <summary>Historial de envíos</summary>
              <p>Registros del chat vinculado actualmente. Confirman que AIRA registró el envío, no la lectura ni la recepción en el dispositivo; los fallos no aparecen aquí.</p>
              <div className="telegramHistoryActions">
                <span>{historyLoading ? 'Actualizando…' : `Página ${deliveryPage}`}</span>
                <button type="button" disabled={historyLoading || !deliveries}
                  onClick={() => loadDeliveries(deliveryPage)}>Actualizar</button>
              </div>
              {deliveries && <>
                <ul className="telegramDeliveryList">{deliveries.envios.map((item, index) => (
                  <li key={`${item.enviadoEn}-${index}`}>
                    <time>{new Date(item.enviadoEn).toLocaleString('es-CL')}</time>
                    <span>{item.edificioNombre} › {item.salaNombre}</span>
                    <b>{{ confirmada: 'Alerta confirmada', mejoria: 'Mejoría pendiente',
                      resuelta: 'Recuperación confirmada' }[item.tipo] || item.tipo}</b>
                  </li>
                ))}</ul>
                {!deliveries.envios.length && <p>No hay envíos registrados para este chat.</p>}
                <div className="inlineActions">
                  <button type="button" disabled={deliveryPage === 1 || historyLoading}
                    onClick={() => loadDeliveries(deliveryPage - 1)}>Anterior</button>
                  <span>Página {deliveryPage}</span>
                  <button type="button" disabled={!deliveries.hayMas || historyLoading}
                    onClick={() => loadDeliveries(deliveryPage + 1)}>Siguiente</button>
                </div>
              </>}
            </details>
          </section>
        </div>
      )}
    </div>
  );
}

/** Nombre: TelegramCodeCountdown. Razón: actualizar el contador sin renderizar nuevamente toda la página.
 * Entradas: fecha de vencimiento y callback de expiración. Salida: tiempo restante del código.
 * Efectos: temporizador local de un segundo hasta que venza el código temporal.
 */
function TelegramCodeCountdown({ expiresAt, onExpire }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [expiresAt]);
  const remaining = Math.max(0, Math.ceil((Date.parse(expiresAt) - now) / 1000));
  useEffect(() => {
    if (remaining === 0) onExpire();
  }, [remaining, onExpire]);
  return `Vence en ${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, '0')}`;
}
