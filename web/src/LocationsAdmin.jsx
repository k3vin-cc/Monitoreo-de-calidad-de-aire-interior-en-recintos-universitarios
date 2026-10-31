import React,{useEffect,useMemo,useRef,useState} from 'react';
import {CircleAlert,Pencil,Plus,RefreshCw,Trash2,X} from 'lucide-react';
import {api} from './services';
import CascadeSelect from './CascadeSelect';

const cfgs={
 sectores:{label:'Sectores',one:'sector',create:api.createSector,patch:api.patchSector,del:api.deleteSector,cols:['Nombre / ID','Descripción']},
 edificios:{label:'Edificios',one:'edificio',create:api.createBuilding,patch:api.patchBuilding,del:api.deleteBuilding,cols:['Nombre / ID','Sector','Dirección']},
 pisos:{label:'Pisos',one:'piso',create:api.createFloor,patch:api.patchFloor,del:api.deleteFloor,cols:['Nombre / ID','Edificio','Nivel']},
 salas:{label:'Salas',one:'sala',create:api.createRoom,patch:api.patchRoom,del:api.deleteRoom,cols:['Nombre / ID','Piso','Capacidad']}
};
export default function LocationsAdmin(){
 const [tab,setTab]=useState('sectores'),[data,setData]=useState({sectores:[],edificios:[],pisos:[],salas:[]}),[busy,setBusy]=useState(true),[refreshing,setRefreshing]=useState(false),[pending,setPending]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState(''),[dialog,setDialog]=useState(null),[dialogError,setDialogError]=useState(''),[retireDialog,setRetireDialog]=useState(null),[listQuery,setListQuery]=useState(''),[sectorFilter,setSectorFilter]=useState(''),[buildingFilter,setBuildingFilter]=useState(''),[floorFilter,setFloorFilter]=useState(''),[page,setPage]=useState(1),[confirmName,setConfirmName]=useState('');
 const writing=useRef(false),requestVersion=useRef(0);
 /** Nombre: reload. Razón: obtiene las listas iniciales con una sola solicitud para reducir la espera de Espacios. Entradas: ninguna; usa la sesión administrativa. Salida: actualiza las listas visibles o el error. Efectos: consulta la API. */
 async function reload(){const version=++requestVersion.current;setRefreshing(true);try{const result=await api.spacesSummary();if(version===requestVersion.current){setData(result);setError('')}}catch(e){if(version===requestVersion.current)setError(e.message)}finally{if(version===requestVersion.current){setBusy(false);setRefreshing(false)}}}
 useEffect(()=>{reload()},[]);
 const cfg=cfgs[tab],rows=data[tab];
 const byId=useMemo(()=>Object.fromEntries(Object.entries(data).map(([key,list])=>[key,new Map(list.map(item=>[item.id,item]))])),[data]);
 const name=(key,id)=>byId[key]?.get(id)?.nombre||id||'—';
 const trail=(entity,item)=>{
  if(entity==='sectores')return [item.nombre];
  if(entity==='edificios')return [name('sectores',item.sectorId),item.nombre];
  if(entity==='pisos'){const b=byId.edificios.get(item.edificioId);return [name('sectores',b?.sectorId),b?.nombre||item.edificioId,item.nombre]}
  const f=byId.pisos.get(item.pisoId),b=byId.edificios.get(f?.edificioId);
  return [name('sectores',b?.sectorId),b?.nombre||f?.edificioId,f?.nombre||item.pisoId,item.nombre].filter(Boolean);
 };
 const buildingOptions=useMemo(()=>data.edificios.filter(item=>!sectorFilter||item.sectorId===sectorFilter),[data.edificios,sectorFilter]);
 const floorOptions=useMemo(()=>data.pisos.filter(item=>(!buildingFilter||item.edificioId===buildingFilter)&&(!sectorFilter||byId.edificios.get(item.edificioId)?.sectorId===sectorFilter)),[data.pisos,byId,buildingFilter,sectorFilter]);
 /** Nombre: filteredRows. Razón: filtrar también por ancestros sin procesar toda la tabla en cada render.
  * Entradas: listas y filtros de la vista. Salida: ubicaciones coincidentes. Efectos: ninguno. */
 const filteredRows=useMemo(()=>rows.filter(item=>{
  const floorId=tab==='salas'?item.pisoId:tab==='pisos'?item.id:'';
  const buildingId=tab==='edificios'?item.id:tab==='pisos'?item.edificioId:byId.pisos.get(item.pisoId)?.edificioId;
  const sectorId=tab==='sectores'?item.id:byId.edificios.get(buildingId)?.sectorId;
  if(sectorFilter&&sectorId!==sectorFilter||buildingFilter&&buildingId!==buildingFilter||floorFilter&&floorId!==floorFilter)return false;
  const searchable=[item.id,item.descripcion,item.direccion,...trail(tab,item)].filter(Boolean).join(' ').toLocaleLowerCase('es');
  return searchable.includes(listQuery.trim().toLocaleLowerCase('es'));
 }),[rows,tab,byId,listQuery,sectorFilter,buildingFilter,floorFilter]);
 const pageSize=20,totalPages=Math.max(1,Math.ceil(filteredRows.length/pageSize)),currentPage=Math.min(page,totalPages);
 const visibleRows=filteredRows.slice((currentPage-1)*pageSize,currentPage*pageSize);
 const buildingLabel=x=>`${name('sectores',x.sectorId)} › ${x.nombre}`;
 const floorLabel=x=>{const b=byId.edificios.get(x.edificioId);return `${name('sectores',b?.sectorId)} › ${b?.nombre||x.edificioId} › ${x.nombre} (nivel ${x.nivel})`};
 const cascadeLevels=entity=>{const sector={label:'Sector',rows:data.sectores,key:'sector'},building={label:'Edificio',rows:data.edificios,key:'building',parentKey:'sectorId',formatOption:x=>x.nombre},floor={label:'Piso',rows:data.pisos,key:'floor',parentKey:'edificioId',formatOption:x=>`${x.nombre} (nivel ${x.nivel})`},room={label:'Sala',rows:data.salas,key:'room',parentKey:'pisoId'};return entity==='edificios'?[sector]:entity==='pisos'?[sector,building]:entity==='salas'?[sector,building,floor]:[sector]};
 const fullPath=(entity,row)=>trail(entity,row).join(' › ')+(entity==='pisos'?` (nivel ${row.nivel})`:'');
 const childSummary=target=>{const item=target.item;if(target.entity==='sectores')return [[item.edificiosActivos,'edificios'],[item.pisosActivos,'pisos'],[item.salasActivas,'salas']];if(target.entity==='edificios')return [[item.pisosActivos,'pisos'],[item.salasActivas,'salas']];if(target.entity==='pisos')return [[item.salasActivas,'salas']];return []};
 /**
  * Nombre: openRetireDialog. Razón: carga los conteos históricos sólo al preparar un retiro.
  * Entradas: entity e item provienen de la fila seleccionada en la tabla.
  * Salida: ninguna; actualiza el diálogo con el detalle o un error recuperable.
  * Efectos: consulta la API sin modificar datos persistentes.
  */
 async function openRetireDialog(entity,item){if(writing.current)return;setConfirmName('');setRetireDialog({entity,item,loading:true,error:'',actionError:'',borrarHistorial:false});try{const rows=entity==='sectores'?await api.sectors({incluirConteosHistorial:true}):entity==='edificios'?await api.buildings(item.sectorId,{incluirConteosHistorial:true}):entity==='pisos'?await api.floors(item.edificioId,{incluirConteosHistorial:true}):await api.rooms({pisoId:item.pisoId},{incluirConteosHistorial:true});const detail=rows.find(row=>row.id===item.id);if(!detail)throw new Error('La ubicación ya no está disponible en el listado.');setRetireDialog(current=>current?.entity===entity&&current.item.id===item.id?{...current,item:detail,loading:false,error:''}:current)}catch(err){setRetireDialog(current=>current?.entity===entity&&current.item.id===item.id?{...current,loading:false,error:err.message||'No se pudieron consultar los conteos del historial.'}:current)}}
 /** Nombre: submit. Razón: guardar una ubicación una sola vez y conservar errores en el formulario.
  * Entradas: formulario del diálogo. Salida: confirmación o error visible. Efectos: crea o edita una ubicación por API. */
 async function submit(e){
  e.preventDefault();if(writing.current||!dialog)return;
  const form=e.currentTarget,body={};
  for(const el of form.elements)if(el.name)body[el.name]=el.type==='number'?Number(el.value):el.value;
  const entity=dialog.entity,parentField={edificios:'sectorId',pisos:'edificioId',salas:'pisoId'}[entity];
  if(parentField&&!body[parentField]){setDialogError(`Selecciona ${entity==='edificios'?'un sector':entity==='pisos'?'un edificio':'un piso'} de la lista.`);return}
  writing.current=true;setPending(true);setDialogError('');setMessage('');
  try{if(dialog.item)await cfgs[entity].patch(dialog.item.id,body);else await cfgs[entity].create(body);setMessage(`${cfgs[entity].one} guardado correctamente.`);setDialog(null);await reload()}
  catch(err){setDialogError(err.message||'No se pudo guardar la ubicación.')}
  finally{writing.current=false;setPending(false)}
 }
 /** Nombre: remove. Razón: impedir retiros repetidos y exigir confirmación escrita si se borrará historial.
  * Entradas: objetivo del diálogo. Salida: resultado o error local. Efectos: retira ubicación y sus dependencias por API. */
 async function remove(){
  if(writing.current||!retireDialog||retireDialog.loading||retireDialog.error)return;
  const target=retireDialog,definition=cfgs[target.entity];
  if(target.borrarHistorial&&confirmName.trim()!==target.item.nombre){setRetireDialog(current=>({...current,actionError:'Escribe el nombre exacto para confirmar el borrado del historial.'}));return}
  writing.current=true;setPending(true);setRetireDialog(current=>({...current,actionError:''}));setMessage('');
  try{
   const result=await definition.del(target.item.id,{borrarHistorial:Boolean(target.borrarHistorial)}),h=result.historial||{};
   const saved=`${Number(h.telemetria||0).toLocaleString('es-CL')} mediciones, ${Number(h.telemetriaIncierta||0).toLocaleString('es-CL')} registros de hora incierta y ${Number(h.alertas||0).toLocaleString('es-CL')} alertas`;
   setMessage(`Se retiró ${definition.one} «${target.item.nombre||target.item.id}». ${target.borrarHistorial?`Se eliminaron ${saved}.`:`Se conservaron ${saved}.`} Los nodos asociados quedaron desvinculados.`);
   setRetireDialog(null);await reload();
  }catch(err){setRetireDialog(current=>current?{...current,actionError:err.message||'No se pudo retirar la ubicación.'}:current)}
  finally{writing.current=false;setPending(false)}
 }
 return <div className="locationsAdmin">
  <div className="pageHeading"><div><span className="eyebrow">ADMINISTRACIÓN / ESTRUCTURA</span><h1>Sectores y espacios</h1><p>Administra sectores, edificios, pisos y salas del campus.</p></div><button className="primary" disabled={pending||busy} onClick={()=>{setDialogError('');setError('');setDialog({entity:tab,item:null})}}><Plus size={17}/>Agregar {cfg.one}</button></div>
  {message&&<div className="notice success crudNotice" role="status">{message}</div>}{error&&<div className="notice error crudNotice" role="alert"><CircleAlert size={16}/>{error}<button className="textButton" onClick={()=>setError('')}>Cerrar</button></div>}
  <div className="crudTabs">{Object.entries(cfgs).map(([k,v])=><button key={k} className={tab===k?'selected':''} disabled={pending} aria-pressed={tab===k} onClick={()=>{setTab(k);setListQuery('');setSectorFilter('');setBuildingFilter('');setFloorFilter('');setPage(1);setMessage('')}}>{v.label}<span>{data[k].length}</span></button>)}</div>
  <section className="panel crudPanel"><div className="panelHead"><div><h2>{cfg.label}</h2><p>Retirar desvincula nodos y conserva el historial por defecto. El borrado permanente exige confirmación adicional.</p></div><button className="iconBtn" title="Actualizar" aria-label="Actualizar espacios" disabled={pending||refreshing} onClick={reload}><RefreshCw size={17}/></button></div><div className="locationFilters"><label className="listSearch">Buscar en {cfg.label.toLowerCase()}<input type="search" value={listQuery} onChange={e=>{setListQuery(e.target.value);setPage(1)}} placeholder="Nombre, ubicación o ID"/></label>
   {tab!=='sectores'&&<label>Sector<select value={sectorFilter} onChange={e=>{setSectorFilter(e.target.value);setBuildingFilter('');setFloorFilter('');setPage(1)}}><option value="">Todos los sectores</option>{data.sectores.map(item=><option key={item.id} value={item.id}>{item.nombre}</option>)}</select></label>}
   {(tab==='pisos'||tab==='salas')&&<label>Edificio<select value={buildingFilter} onChange={e=>{setBuildingFilter(e.target.value);setFloorFilter('');setPage(1)}}><option value="">Todos los edificios</option>{buildingOptions.map(item=><option key={item.id} value={item.id}>{name('sectores',item.sectorId)} › {item.nombre}</option>)}</select></label>}
   {tab==='salas'&&<label>Piso<select value={floorFilter} onChange={e=>{setFloorFilter(e.target.value);setPage(1)}}><option value="">Todos los pisos</option>{floorOptions.map(item=><option key={item.id} value={item.id}>{name('edificios',item.edificioId)} › {item.nombre}</option>)}</select></label>}
   {(listQuery||sectorFilter||buildingFilter||floorFilter)&&<button className="secondary compact" onClick={()=>{setListQuery('');setSectorFilter('');setBuildingFilter('');setFloorFilter('');setPage(1)}}>Limpiar filtros</button>}
   </div>
   {busy?<div className="loading">Cargando estructura…</div>:<><span className="locationResultCount" role="status">{refreshing?'Actualizando…':`${filteredRows.length} de ${rows.length} registros · mostrando ${filteredRows.length?(currentPage-1)*pageSize+1:0}–${Math.min(currentPage*pageSize,filteredRows.length)}`}</span><div className="tableScroll"><table><thead><tr>{cfg.cols.map(x=><th key={x}>{x}</th>)}<th>Acciones</th></tr></thead><tbody>{visibleRows.map(item=><tr key={item.id}><td data-label="Nombre"><b>{item.nombre}</b><small className="block locationId">{item.id}</small>{tab==='salas'&&<small className="block locationMeta">{item.nodosActivos||0} nodos activos</small>}</td>{tab==='sectores'&&<td data-label="Descripción">{item.descripcion||'—'}</td>}{tab==='edificios'&&<><td data-label="Sector">{name('sectores',item.sectorId)}</td><td data-label="Dirección">{item.direccion||'—'}</td></>}{tab==='pisos'&&<><td data-label="Ubicación">{trail('pisos',item).slice(0,-1).join(' › ')}</td><td data-label="Nivel">{item.nivel}</td></>}{tab==='salas'&&<><td data-label="Ubicación">{trail('salas',item).slice(0,-1).join(' › ')}</td><td data-label="Capacidad">{item.capacidadOcupantes}</td></>}<td data-label="Acciones"><div className="rowActions"><button className="iconBtn" title="Editar" disabled={pending} aria-label={`Editar ${item.nombre}`} onClick={()=>{setDialogError('');setError('');setDialog({entity:tab,item})}}><Pencil size={16}/></button><button className="iconBtn dangerIcon" title="Retirar con historial" aria-label={`Retirar ${item.nombre}`} disabled={pending} onClick={()=>openRetireDialog(tab,item)}><Trash2 size={16}/></button></div></td></tr>)}</tbody></table>{rows.length>0&&!filteredRows.length&&<div className="empty"><b>No hay coincidencias</b><span>Prueba con otro nombre, ubicación o ID.</span></div>}{!rows.length&&<div className="empty"><b>No hay {cfg.label.toLowerCase()} registrados</b><span>Usa Agregar para crear el primero.</span></div>}</div>{totalPages>1&&<nav className="locationPages" aria-label="Páginas de espacios"><button className="secondary compact" disabled={currentPage===1} onClick={()=>setPage(currentPage-1)}>Anterior</button><span>Página {currentPage} de {totalPages}</span><button className="secondary compact" disabled={currentPage===totalPages} onClick={()=>setPage(currentPage+1)}>Siguiente</button></nav>}</>}
  </section>
  {dialog&&<LocationDialog labelId="location-edit-title" pending={pending} onClose={()=>setDialog(null)}><div className="panelHead"><div><span className="eyebrow">ADMINISTRACIÓN</span><h2 id="location-edit-title">{dialog.item?'Editar':'Agregar'} {cfgs[dialog.entity].one}</h2></div><button className="iconBtn" disabled={pending} onClick={()=>setDialog(null)} aria-label="Cerrar"><X size={20}/></button></div>{dialogError&&<div className="notice error" role="alert">{dialogError}</div>}<form className="stack" onSubmit={submit}><div className="formGrid">
   {dialog.entity==='sectores'&&<><label>Nombre<input name="nombre" defaultValue={dialog.item?.nombre||''} required maxLength="100"/></label><label className="spanTwo">Descripción<textarea name="descripcion" defaultValue={dialog.item?.descripcion||''}/></label></>}
   {dialog.entity==='edificios'&&<><CascadeSelect name="sectorId" label="Sector" levels={cascadeLevels('sectores')} value={dialog.item?.sectorId||''} required formatPath={row=>fullPath('sectores',row)}/><label>Nombre<input name="nombre" defaultValue={dialog.item?.nombre||''} required maxLength="100"/></label><label>Dirección<input name="direccion" defaultValue={dialog.item?.direccion||''} maxLength="200"/></label></>}
   {dialog.entity==='pisos'&&<><CascadeSelect name="edificioId" label="Edificio" levels={cascadeLevels('pisos')} value={dialog.item?.edificioId||''} required formatPath={row=>fullPath('edificios',row)}/><label>Nombre<input name="nombre" defaultValue={dialog.item?.nombre||''} required maxLength="50"/></label><label>Nivel<input name="nivel" type="number" defaultValue={dialog.item?.nivel??1} required/></label></>}
   {dialog.entity==='salas'&&<><CascadeSelect name="pisoId" label="Piso" levels={cascadeLevels('salas')} value={dialog.item?.pisoId||''} required formatPath={row=>fullPath('pisos',row)}/><label>Nombre<input name="nombre" defaultValue={dialog.item?.nombre||''} required maxLength="100"/></label><label>Capacidad<input name="capacidadOcupantes" type="number" min="1" defaultValue={dialog.item?.capacidadOcupantes??1} required/></label></>}
   </div><div className="dialogActions"><button type="button" className="secondary" disabled={pending} onClick={()=>setDialog(null)}>Cancelar</button><button className="primary" disabled={pending}><Plus size={16}/>{pending?'Guardando…':dialog.item?'Guardar cambios':'Crear '+cfgs[dialog.entity].one}</button></div></form></LocationDialog>}
  {retireDialog&&<LocationDialog labelId="location-retire-title" alert pending={pending} onClose={()=>setRetireDialog(null)}><div className="panelHead"><div><span className="eyebrow">CONFIRMACIÓN DE RETIRO</span><h2 id="location-retire-title">¿Retirar {cfgs[retireDialog.entity].one} «{retireDialog.item.nombre||retireDialog.item.id}»?</h2></div><button className="iconBtn" disabled={pending} onClick={()=>setRetireDialog(null)} aria-label="Cerrar"><X size={20}/></button></div><div className="stack"><p>La ubicación dejará de aparecer en la estructura activa. El historial se conserva salvo que marques la opción de borrado.</p><div className="readOnly"><b>Ubicación</b><span>{trail(retireDialog.entity,retireDialog.item).join(' › ')}</span></div>{childSummary(retireDialog).some(([count])=>Number(count)>0)&&<div className="readOnly"><b>También se retirarán</b>{childSummary(retireDialog).filter(([count])=>Number(count)>0).map(([count,label])=><span key={label}>{Number(count).toLocaleString('es-CL')} {label}</span>)}</div>}{retireDialog.loading?<div className="loading">Consultando el historial asociado…</div>:retireDialog.error?<div className="notice error">{retireDialog.error}<button type="button" className="textButton" onClick={()=>openRetireDialog(retireDialog.entity,retireDialog.item)}>Reintentar</button></div>:<div className="readOnly"><b>Historial asociado</b><span>{Number(retireDialog.item.telemetriaTotal||0).toLocaleString('es-CL')} mediciones</span><span>{Number(retireDialog.item.telemetriaInciertaTotal||0).toLocaleString('es-CL')} registros de hora incierta</span><span>{Number(retireDialog.item.alertasTotal||0).toLocaleString('es-CL')} alertas</span><span>{Number(retireDialog.item.nodosActivos||0).toLocaleString('es-CL')} nodos asociados se desvincularán.</span></div>}<label className="checkRow"><input type="checkbox" checked={Boolean(retireDialog.borrarHistorial)} disabled={pending||retireDialog.loading||Boolean(retireDialog.error)} onChange={e=>{setConfirmName('');setRetireDialog(x=>({...x,borrarHistorial:e.target.checked,actionError:''}))}}/><span><b>Borrar también este historial</b><small>Elimina permanentemente las mediciones y alertas de esta ubicación y sus dependencias. Esta acción no se puede deshacer.</small></span></label>{retireDialog.borrarHistorial&&<label className="locationConfirmName">Para borrar el historial escribe «{retireDialog.item.nombre}»<input value={confirmName} disabled={pending} onChange={e=>setConfirmName(e.target.value)} autoComplete="off"/></label>}{retireDialog.actionError&&<div className="notice error" role="alert">{retireDialog.actionError}</div>}<p className="helper">El nombre podrá reutilizarse en la misma ubicación superior. Los IDs retirados se conservan para mantener referencias, salvo que el elemento se elimine después de borrar sus dependencias.</p><div className="dialogActions"><button type="button" className="secondary" disabled={pending} onClick={()=>setRetireDialog(null)}>Cancelar</button><button type="button" className="primary dangerButton" onClick={remove} disabled={pending||retireDialog.loading||Boolean(retireDialog.error)||retireDialog.borrarHistorial&&confirmName.trim()!==retireDialog.item.nombre}><Trash2 size={16}/>{pending?'Procesando…':retireDialog.borrarHistorial?'Retirar y borrar historial':'Sí, retirar '+cfgs[retireDialog.entity].one}</button></div></div></LocationDialog>}
 </div>;
}

/** Nombre: LocationDialog. Razón: contener el foco y permitir cerrar con Escape sin perder un guardado.
 * Entradas: contenido, título, estado pendiente y cierre. Salida: diálogo modal. Efectos: bloquea scroll y restaura foco. */
function LocationDialog({labelId,alert=false,pending,onClose,children}){
 const ref=useRef(null);
 useEffect(()=>{
  const opener=document.activeElement,overflow=document.body.style.overflow,element=ref.current;
  element.showModal();document.body.style.overflow='hidden';
  return()=>{element.close();document.body.style.overflow=overflow;if(opener?.isConnected)opener.focus()};
 },[]);
 return <dialog ref={ref} className="userDialog locationModal" role={alert?'alertdialog':'dialog'} aria-labelledby={labelId} aria-busy={pending} onCancel={e=>{e.preventDefault();if(!pending)onClose()}}>{children}</dialog>;
}

