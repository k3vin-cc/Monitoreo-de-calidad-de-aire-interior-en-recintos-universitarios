import React,{useEffect,useMemo,useRef,useState} from 'react';
import {Building2,ChevronRight,CircleAlert,Cpu,Layers3,MapPin,Pencil,Plus,RefreshCw,Search,Trash2,X} from 'lucide-react';
import {Link} from 'react-router-dom';
import {api} from './services';
import CascadeSelect from './CascadeSelect';

const cfgs={
 sectores:{label:'Sectores',one:'sector',create:api.createSector,patch:api.patchSector,del:api.deleteSector},
 edificios:{label:'Edificios',one:'edificio',create:api.createBuilding,patch:api.patchBuilding,del:api.deleteBuilding},
 pisos:{label:'Pisos',one:'piso',create:api.createFloor,patch:api.patchFloor,del:api.deleteFloor},
 salas:{label:'Salas',one:'sala',create:api.createRoom,patch:api.patchRoom,del:api.deleteRoom}
};
export default function LocationsAdmin(){
 const [selected,setSelected]=useState({sectorId:'',buildingId:'',floorId:'',roomId:''}),[data,setData]=useState({sectores:[],edificios:[],pisos:[],salas:[]}),[nodes,setNodes]=useState([]),[nodesBusy,setNodesBusy]=useState(false),[nodesLoaded,setNodesLoaded]=useState(false),[nodesError,setNodesError]=useState(''),[busy,setBusy]=useState(true),[refreshing,setRefreshing]=useState(false),[pending,setPending]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState(''),[dialog,setDialog]=useState(null),[dialogError,setDialogError]=useState(''),[retireDialog,setRetireDialog]=useState(null),[listQuery,setListQuery]=useState(''),[searchAll,setSearchAll]=useState(false),[page,setPage]=useState(1),[confirmName,setConfirmName]=useState('');
 const writing=useRef(false),requestVersion=useRef(0),nodesRequest=useRef(false);
 /** Nombre: reload. Razón: obtiene las listas iniciales con una sola solicitud para reducir la espera de Espacios. Entradas: ninguna; usa la sesión administrativa. Salida: actualiza las listas visibles o el error. Efectos: consulta la API. */
 async function reload(){const version=++requestVersion.current;setRefreshing(true);try{const result=await api.spacesSummary();if(version===requestVersion.current){setData(result);setError('')}}catch(e){if(version===requestVersion.current)setError(e.message)}finally{if(version===requestVersion.current){setBusy(false);setRefreshing(false)}}}
 useEffect(()=>{reload()},[]);
 const tab=selected.roomId?'nodos':selected.floorId?'salas':selected.buildingId?'pisos':selected.sectorId?'edificios':'sectores';
 const cfg=cfgs[tab];
 const byId=useMemo(()=>Object.fromEntries(Object.entries(data).map(([key,list])=>[key,new Map(list.map(item=>[item.id,item]))])),[data]);
 /** Nombre: reconciliar selección. Razón: actualizar la ruta si una ubicación se mueve o se retira.
  * Entradas: listas recargadas e IDs seleccionados. Salida: ruta válida. Efectos: sólo estado de React. */
 useEffect(()=>{
  if(busy||!selected.sectorId)return;
  const room=byId.salas.get(selected.roomId),floor=byId.pisos.get(room?.pisoId||selected.floorId);
  const building=byId.edificios.get(floor?.edificioId||selected.buildingId);
  const next={sectorId:building?.sectorId||selected.sectorId,buildingId:building?.id||'',floorId:floor?.id||'',roomId:room?.id||''};
  if(!byId.sectores.has(next.sectorId))next.sectorId='';
  if(Object.keys(next).some(key=>next[key]!==selected[key])){setSelected(next);setListQuery('');setPage(1)}
 },[data,busy,selected,byId]);
 const name=(key,id)=>byId[key]?.get(id)?.nombre||id||'—';
 const trail=(entity,item)=>{
  if(entity==='sectores')return [item.nombre];
  if(entity==='edificios')return [name('sectores',item.sectorId),item.nombre];
  if(entity==='pisos'){const b=byId.edificios.get(item.edificioId);return [name('sectores',b?.sectorId),b?.nombre||item.edificioId,item.nombre]}
  const f=byId.pisos.get(item.pisoId),b=byId.edificios.get(f?.edificioId);
  return [name('sectores',b?.sectorId),b?.nombre||f?.edificioId,f?.nombre||item.pisoId,item.nombre].filter(Boolean);
 };
 /** Nombre: loadNodes. Razón: consultar nodos sólo al abrir una sala o buscar en toda la estructura.
  * Entradas: sesión ADMIN vigente. Salida: lista de nodos o error recuperable. Efectos: consulta GET /nodos. */
 async function loadNodes(){
  if(nodesRequest.current)return;
  nodesRequest.current=true;setNodesBusy(true);setNodesError('');
  try{setNodes(await api.nodes());setNodesLoaded(true)}
  catch(err){setNodesError(err.message||'No se pudieron cargar los nodos.')}
  finally{nodesRequest.current=false;setNodesBusy(false)}
 }
 useEffect(()=>{if((selected.roomId||searchAll&&listQuery.trim())&&!nodesLoaded&&!nodesError)loadNodes()},[selected.roomId,searchAll,listQuery,nodesLoaded,nodesError]);
 /** Nombre: enter. Razón: mantener una sola rama visible de la jerarquía y reiniciar la búsqueda local.
  * Entradas: nivel e ID seleccionados. Salida: siguiente nivel visible. Efectos: sólo estado de React. */
 function enter(entity,id){
  if(entity==='sectores')setSelected({sectorId:id,buildingId:'',floorId:'',roomId:''});
  if(entity==='edificios')setSelected(current=>({...current,buildingId:id,floorId:'',roomId:''}));
  if(entity==='pisos')setSelected(current=>({...current,floorId:id,roomId:''}));
  if(entity==='salas')setSelected(current=>({...current,roomId:id}));
  setListQuery('');setSearchAll(false);setPage(1);setMessage('');
 }
 /** Nombre: openResult. Razón: llevar un resultado global directamente a su ubicación.
  * Entradas: tipo e item del resultado. Salida: nivel abierto. Efectos: sólo estado de React. */
 function openResult(entity,item){
  const room=entity==='nodos'?byId.salas.get(item.salaId):entity==='salas'?item:null;
  const floor=entity==='pisos'?item:room?byId.pisos.get(room.pisoId):null;
  const building=entity==='edificios'?item:floor?byId.edificios.get(floor.edificioId):null;
  const sector=entity==='sectores'?item:building?byId.sectores.get(building.sectorId):null;
  setSelected({sectorId:sector?.id||'',buildingId:building?.id||'',floorId:floor?.id||'',roomId:room?.id||''});
  setListQuery(entity==='nodos'?item.nombre||item.id:'');setSearchAll(false);setPage(1);
 }
 const rows=useMemo(()=>{
  if(tab==='sectores')return data.sectores;
  if(tab==='edificios')return data.edificios.filter(x=>x.sectorId===selected.sectorId);
  if(tab==='pisos')return data.pisos.filter(x=>x.edificioId===selected.buildingId);
  if(tab==='salas')return data.salas.filter(x=>x.pisoId===selected.floorId);
  return nodes.filter(x=>x.salaId===selected.roomId);
 },[data,nodes,tab,selected]);
 /** Nombre: filteredRows. Razón: buscar sólo dentro del nivel visible o en toda la estructura.
  * Entradas: listas, selección y texto. Salida: filas coincidentes. Efectos: ninguno. */
 const filteredRows=useMemo(()=>{
  const query=listQuery.trim().toLocaleLowerCase('es');
  if(!query)return rows.map(item=>({entity:tab,item}));
  const collections=searchAll?[...Object.entries(data),['nodos',nodes.filter(x=>x.salaId&&byId.salas.has(x.salaId))]]:[[tab,rows]];
  return collections.flatMap(([entity,items])=>items.filter(item=>{
   const path=entity==='nodos'?trail('salas',byId.salas.get(item.salaId)||{pisoId:'',nombre:''}):trail(entity,item);
   return [item.nombre,item.id,item.descripcion,item.direccion,...(searchAll?path:[])].filter(Boolean).join(' ').toLocaleLowerCase('es').includes(query);
  }).map(item=>({entity,item})));
 },[rows,tab,data,nodes,byId,listQuery,searchAll]);
 const pageSize=20,totalPages=Math.max(1,Math.ceil(filteredRows.length/pageSize)),currentPage=Math.min(page,totalPages);
 const visibleRows=filteredRows.slice((currentPage-1)*pageSize,currentPage*pageSize);
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
  <div className="pageHeading"><div><span className="eyebrow">ADMINISTRACIÓN / ESTRUCTURA</span><h1>Sectores y espacios</h1><p>Explora la estructura del campus desde el sector hasta los nodos de cada sala.</p></div>{tab==='nodos'?<Link className="primary" to="/nodos/administrar"><Cpu size={17}/>Administrar nodos</Link>:<button className="primary" disabled={pending||busy} onClick={()=>{setDialogError('');setError('');setDialog({entity:tab,item:null,parentId:selected.floorId||selected.buildingId||selected.sectorId||''})}}><Plus size={17}/>Agregar {cfg.one}</button>}</div>
  {message&&<div className="notice success crudNotice" role="status">{message}</div>}{error&&<div className="notice error crudNotice" role="alert"><CircleAlert size={16}/>{error}<button className="textButton" onClick={()=>setError('')}>Cerrar</button></div>}
  <nav className="locationTrail" aria-label="Ruta de espacios"><button onClick={()=>{setSelected({sectorId:'',buildingId:'',floorId:'',roomId:''});setListQuery('');setSearchAll(false);setPage(1)}} aria-current={tab==='sectores'?'page':undefined}>Sectores</button>{selected.sectorId&&<><ChevronRight size={15}/><button onClick={()=>enter('sectores',selected.sectorId)} aria-current={tab==='edificios'?'page':undefined}>{name('sectores',selected.sectorId)}</button></>}{selected.buildingId&&<><ChevronRight size={15}/><button onClick={()=>enter('edificios',selected.buildingId)} aria-current={tab==='pisos'?'page':undefined}>{name('edificios',selected.buildingId)}</button></>}{selected.floorId&&<><ChevronRight size={15}/><button onClick={()=>enter('pisos',selected.floorId)} aria-current={tab==='salas'?'page':undefined}>{name('pisos',selected.floorId)}</button></>}{selected.roomId&&<><ChevronRight size={15}/><span aria-current="page">{name('salas',selected.roomId)}</span></>}</nav>
  <section className="panel locationExplorer"><div className="locationExplorerHead"><div><span className="eyebrow">{tab==='nodos'?'SALA SELECCIONADA':tab==='sectores'?'CAMPUS':'CONTENIDO DE LA UBICACIÓN'}</span><h2>{tab==='nodos'?'Nodos de '+name('salas',selected.roomId):cfg.label}</h2><p>{tab==='sectores'?'Selecciona un sector para ver sus edificios.':tab==='edificios'?'Selecciona un edificio para ver sus pisos.':tab==='pisos'?'Selecciona un piso para ver sus salas.':tab==='salas'?'Selecciona una sala para ver sus nodos.':'Dispositivos asignados a esta sala.'}</p></div><button className="iconBtn" title="Actualizar" aria-label="Actualizar espacios" disabled={pending||refreshing} onClick={()=>{reload();if(nodesLoaded)loadNodes()}}><RefreshCw size={17}/></button></div>
   <div className="locationSearch"><label><Search size={17}/><span className="srOnly">Buscar espacios</span><input type="search" value={listQuery} onChange={e=>{setListQuery(e.target.value);setPage(1)}} placeholder={searchAll?'Buscar sector, edificio, piso, sala o nodo':'Buscar '+(tab==='nodos'?'nodos':cfg.label.toLowerCase())+' en este nivel'}/></label><label className="locationSearchAll"><input type="checkbox" checked={searchAll} onChange={e=>{setSearchAll(e.target.checked);setPage(1)}}/>Buscar en toda la estructura</label></div>
   {busy?<div className="loading">Cargando estructura…</div>:<>
    {nodesError&&(tab==='nodos'||searchAll&&listQuery)&&<div className="notice error" role="alert">{nodesError}<button className="textButton" onClick={loadNodes}>Reintentar</button></div>}
    {nodesBusy&&(tab==='nodos'||searchAll&&listQuery)&&<div className="locationResultCount" role="status">Cargando nodos…</div>}
    <span className="locationResultCount" role="status">{refreshing?'Actualizando…':`${filteredRows.length} ${searchAll&&listQuery?'resultados en la estructura':'de '+rows.length+' en este nivel'} · mostrando ${filteredRows.length?(currentPage-1)*pageSize+1:0}–${Math.min(currentPage*pageSize,filteredRows.length)}`}</span>
    {searchAll&&listQuery?<div className="locationCompactList">{visibleRows.map(({entity,item})=><button className="locationSearchResult" key={`${entity}-${item.id}`} onClick={()=>openResult(entity,item)}><span className="locationResultType">{entity==='nodos'?'Nodo':cfgs[entity].one}</span><span><b>{item.nombre||item.id}</b><small>{entity==='nodos'?trail('salas',byId.salas.get(item.salaId)).join(' › '):trail(entity,item).join(' › ')}</small></span><ChevronRight size={18}/></button>)}</div>:tab==='sectores'||tab==='edificios'?<div className="locationCardGrid">{visibleRows.map(({entity,item})=><article className="locationExploreCard" key={item.id}><div className="locationExploreIcon">{entity==='sectores'?<MapPin size={23}/>:<Building2 size={23}/>}</div><div><span className="eyebrow">{entity==='sectores'?'SECTOR':'EDIFICIO'}</span><h3>{item.nombre}</h3><p>{entity==='sectores'?item.descripcion||'Sin descripción':item.direccion||'Sin dirección registrada'}</p></div><div className="locationExploreCounts"><span><b>{item.edificiosActivos??item.pisosActivos??0}</b> {entity==='sectores'?'edificios':'pisos'}</span><span><b>{item.salasActivas||0}</b> salas</span><span><b>{item.nodosActivos||0}</b> nodos</span></div><div className="locationExploreFoot"><button className="locationOpen" onClick={()=>enter(entity,item.id)}>Ver {entity==='sectores'?'edificios':'pisos'} <ChevronRight size={17}/></button><div className="rowActions"><button className="iconBtn" title="Editar" disabled={pending} aria-label={`Editar ${item.nombre}`} onClick={()=>{setDialogError('');setDialog({entity,item})}}><Pencil size={16}/></button><button className="iconBtn dangerIcon" title="Retirar" disabled={pending} aria-label={`Retirar ${item.nombre}`} onClick={()=>openRetireDialog(entity,item)}><Trash2 size={16}/></button></div></div></article>)}</div>:<div className="locationCompactList">{visibleRows.map(({entity,item})=><article className="locationCompactItem" key={item.id}><div className="locationCompactIcon">{entity==='pisos'?<Layers3 size={21}/>:entity==='salas'?<MapPin size={21}/>:<Cpu size={21}/>}</div><div className="locationCompactText"><span className="eyebrow">{entity==='pisos'?'PISO':entity==='salas'?'SALA':'NODO'}</span><h3>{item.nombre||item.id}</h3><small>{entity==='pisos'?`Nivel ${item.nivel} · ${item.salasActivas||0} salas · ${item.nodosActivos||0} nodos`:entity==='salas'?`Capacidad ${item.capacidadOcupantes} · ${item.nodosActivos||0} nodos activos`:`${item.id} · ${item.estado||'Sin estado'}`}</small></div><div className="locationCompactActions">{entity==='nodos'?<Link className="secondary compact" to="/nodos/administrar">Administrar</Link>:<><button className="secondary compact" onClick={()=>enter(entity,item.id)}>Ver {entity==='pisos'?'salas':'nodos'} <ChevronRight size={16}/></button><button className="iconBtn" title="Editar" disabled={pending} aria-label={`Editar ${item.nombre}`} onClick={()=>{setDialogError('');setDialog({entity,item})}}><Pencil size={16}/></button><button className="iconBtn dangerIcon" title="Retirar" disabled={pending} aria-label={`Retirar ${item.nombre}`} onClick={()=>openRetireDialog(entity,item)}><Trash2 size={16}/></button></>}</div></article>)}</div>}
    {!filteredRows.length&&!nodesBusy&&<div className="empty"><b>{listQuery?'No hay coincidencias':tab==='nodos'?'No hay nodos asignados':'No hay '+cfg.label.toLowerCase()+' en este nivel'}</b><span>{listQuery?'Prueba con otro nombre o ID.':tab==='nodos'?'Asigna un nodo desde Administrar nodos.':'Usa Agregar para crear el primero.'}</span></div>}
    {totalPages>1&&<nav className="locationPages" aria-label="Páginas de espacios"><button className="secondary compact" disabled={currentPage===1} onClick={()=>setPage(currentPage-1)}>Anterior</button><span>Página {currentPage} de {totalPages}</span><button className="secondary compact" disabled={currentPage===totalPages} onClick={()=>setPage(currentPage+1)}>Siguiente</button></nav>}
   </>}
  </section>
  {dialog&&<LocationDialog labelId="location-edit-title" pending={pending} onClose={()=>setDialog(null)}><div className="panelHead"><div><span className="eyebrow">ADMINISTRACIÓN</span><h2 id="location-edit-title">{dialog.item?'Editar':'Agregar'} {cfgs[dialog.entity].one}</h2></div><button className="iconBtn" disabled={pending} onClick={()=>setDialog(null)} aria-label="Cerrar"><X size={20}/></button></div>{dialogError&&<div className="notice error" role="alert">{dialogError}</div>}<form className="stack" onSubmit={submit}><div className="formGrid">
   {dialog.entity==='sectores'&&<><label>Nombre<input name="nombre" defaultValue={dialog.item?.nombre||''} required maxLength="100"/></label><label className="spanTwo">Descripción<textarea name="descripcion" defaultValue={dialog.item?.descripcion||''}/></label></>}
   {dialog.entity==='edificios'&&<><CascadeSelect name="sectorId" label="Sector" levels={cascadeLevels('sectores')} value={dialog.item?.sectorId||dialog.parentId||''} required formatPath={row=>fullPath('sectores',row)}/><label>Nombre<input name="nombre" defaultValue={dialog.item?.nombre||''} required maxLength="100"/></label><label>Dirección<input name="direccion" defaultValue={dialog.item?.direccion||''} maxLength="200"/></label></>}
   {dialog.entity==='pisos'&&<><CascadeSelect name="edificioId" label="Edificio" levels={cascadeLevels('pisos')} value={dialog.item?.edificioId||dialog.parentId||''} required formatPath={row=>fullPath('edificios',row)}/><label>Nombre<input name="nombre" defaultValue={dialog.item?.nombre||''} required maxLength="50"/></label><label>Nivel<input name="nivel" type="number" defaultValue={dialog.item?.nivel??1} required/></label></>}
   {dialog.entity==='salas'&&<><CascadeSelect name="pisoId" label="Piso" levels={cascadeLevels('salas')} value={dialog.item?.pisoId||dialog.parentId||''} required formatPath={row=>fullPath('pisos',row)}/><label>Nombre<input name="nombre" defaultValue={dialog.item?.nombre||''} required maxLength="100"/></label><label>Capacidad<input name="capacidadOcupantes" type="number" min="1" defaultValue={dialog.item?.capacidadOcupantes??1} required/></label></>}
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

