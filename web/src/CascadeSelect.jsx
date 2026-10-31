import React,{useEffect,useRef,useState} from 'react';
import {ChevronDown} from 'lucide-react';

function normalize(value){return String(value||'').toLocaleLowerCase('es').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim()}
function distance(a,b){
 const prev=Array.from({length:b.length+1},(_,i)=>i);
 for(let i=1;i<=a.length;i++){
  let diagonal=prev[0];prev[0]=i;
  for(let j=1;j<=b.length;j++){
   const above=prev[j];prev[j]=Math.min(prev[j]+1,prev[j-1]+1,diagonal+(a[i-1]===b[j-1]?0:1));diagonal=above;
  }
 }
 return prev[b.length];
}
function similarity(query,text){
 const q=normalize(query),value=normalize(text);
 if(!q)return 1;
 if(value===q)return 1;
 if(value.startsWith(q))return .98;
 if(value.includes(q))return .95;
 const queryWords=q.split(/\s+/).filter(Boolean),textWords=value.split(/[^a-z0-9]+/).filter(Boolean);
 if(!queryWords.length||!textWords.length)return 0;
 const scores=queryWords.map(word=>Math.max(...textWords.map(candidate=>{
  if(candidate===word)return 1;
  if(candidate.startsWith(word)||word.startsWith(candidate))return .88;
  const ratio=1-distance(word,candidate)/Math.max(word.length,candidate.length);
  return ratio>=.45?ratio:0;
 })));
 const score=scores.reduce((sum,n)=>sum+n,0)/scores.length;
 return score>=.48?.55+score*.4:0;
}
function pathForValue(levels,value){
 const path=Array(levels.length).fill('');let id=value;
 for(let i=levels.length-1;i>=0;i--){
  const row=levels[i].rows.find(item=>item.id===id);if(!row)break;
  path[i]=row.id;id=levels[i].parentKey?row[levels[i].parentKey]:'';
 }
 return path;
}

export default function CascadeSelect({name,label,levels,value='',required=false,formatPath,searchPlaceholder,emptyLabel='Selecciona…',onChange,hideLabel=false,compact=false}){
 // Las cargas de datos y los cambios de valor no deben desplegar opciones por sí solos.
 const firstOpen=()=>levels.map(()=>false);
 const rootRef=useRef(null);
 const [path,setPath]=useState(()=>pathForValue(levels,value)),[queries,setQueries]=useState(()=>levels.map(()=>'')),[open,setOpen]=useState(firstOpen);
 const levelsKey=levels.map(level=>`${level.key||level.label}:${level.rows.length}`).join('|');
 useEffect(()=>{setPath(pathForValue(levels,value));setQueries(levels.map(()=>''));setOpen(firstOpen())},[value,levelsKey]);
 /** Nombre: cerrar al salir. Razón: evitar listas persistentes al interactuar con otro control.
  * Entradas: eventos del documento. Salida: cierra opciones. Efectos: registra y limpia un listener. */
 useEffect(()=>{
  const closeOutside=event=>{if(!rootRef.current?.contains(event.target))setOpen(current=>current.map(()=>false))};
  document.addEventListener('pointerdown',closeOutside);
  return()=>document.removeEventListener('pointerdown',closeOutside);
 },[]);
 const optionsAt=i=>{
  if(compact&&i===levels.length-1)return levels[i].rows;
  const level=levels[i];if(i===0||!level.parentKey)return level.rows;
  const parentId=path[i-1];return parentId?level.rows.filter(row=>row[level.parentKey]===parentId):[];
 };
 const visibleOptions=i=>{
  const level=levels[i],base=optionsAt(i),query=queries[i]||'';
  const format=row=>compact&&i===levels.length-1?(formatPath?.(row)||row.nombre||row.id):(level.formatOption?.(row)||row.nombre||row.id);
  const ranked=base.map((row,index)=>({row,index,score:similarity(query,`${format(row)} ${row.id||''}`)})).filter(item=>item.score>0).sort((a,b)=>b.score-a.score||a.index-b.index);
  const matches=ranked.map(item=>item.row),selected=base.find(row=>row.id===path[i]);
  const display=selected&&!matches.some(row=>row.id===selected.id)?[selected,...matches]:matches;
  return {base,display:display.slice(0,100),matchCount:matches.length,format};
 };
 const clearTerminal=()=>{setPath(Array(levels.length).fill(''));setQueries(levels.map(()=>''));setOpen(firstOpen());onChange?.('')};
 const choose=(i,row)=>{
  const next=[...path];next[i]=row.id;for(let j=i+1;j<next.length;j++)next[j]='';
  setPath(next);setQueries(current=>current.map((q,index)=>index>=i?'':q));
  setOpen(firstOpen());
  if(i===levels.length-1)onChange?.(row.id);else onChange?.('');
 };
 return <div ref={rootRef} onKeyDown={event=>{if(event.key==='Escape'&&open.some(Boolean)){event.preventDefault();event.stopPropagation();setOpen(firstOpen());rootRef.current?.querySelector('[aria-expanded="true"]')?.focus()}}} className={`cascadeField${hideLabel?' visuallyHiddenLabel':''}${compact?' compactCascade':''}`}>
  <span className="cascadeLabel">{label}</span>
  <input type="hidden" name={name} value={path[path.length-1]||''} required={false}/>
  <div className="cascadeLevels">{levels.map((level,i)=>{
   if(compact&&i!==levels.length-1)return null;
   const {base,display,matchCount,format}=visibleOptions(i),waiting=i>0&&!path[i-1]&&!compact;
   const selected=base.find(row=>row.id===path[i]);
   const selectedText=selected?format(selected):waiting?`Selecciona ${levels[i-1]?.label.toLocaleLowerCase('es')} primero`:emptyLabel;
   const toggle=()=>{if(waiting)return;setOpen(current=>current.map((v,index)=>index===i?!v:false))};
   return <div className="cascadeFilter" key={level.key||level.label}>
    <label>{level.label}</label>
    <button type="button" className="cascadeFilterButton" aria-expanded={Boolean(open[i])} onClick={toggle} disabled={waiting} title={selectedText}><span>{selectedText}</span><ChevronDown size={14}/></button>
    {open[i]&&!waiting&&<div className="cascadeOptionsPanel">
     <input type="search" value={queries[i]||''} onChange={e=>setQueries(current=>current.map((q,index)=>index===i?e.target.value:q))} placeholder={searchPlaceholder&&i===levels.length-1?searchPlaceholder:`Buscar ${level.label.toLocaleLowerCase('es')}`} autoComplete="off" aria-label={`Buscar ${level.label.toLocaleLowerCase('es')}`}/>
     <div className="cascadeOptionList" role="listbox" aria-label={`Resultados de ${level.label}`}>
      {!required&&i===levels.length-1&&<button type="button" role="option" aria-selected={!path[i]} onMouseDown={e=>e.preventDefault()} onClick={clearTerminal}>Sin asignar</button>}
      {display.length?display.map(row=><button type="button" role="option" aria-selected={row.id===path[i]} key={row.id} onMouseDown={e=>e.preventDefault()} onClick={()=>choose(i,row)}>{format(row)}</button>):<span>No hay coincidencias. Prueba otro nombre o ubicación.</span>}
     </div>
     <small>{queries[i]?`${matchCount} coincidencias por nombre, ubicación o similitud`:base.length>100?`Mostrando 100 de ${base.length}; escribe para acotar`:`${base.length} ${base.length===1?'opción':'opciones'} disponibles`}</small>
    </div>}
   </div>;
  })}</div>
  {required&&!path[path.length-1]&&<span className="cascadeRequiredHint">Selecciona {levels[levels.length-1]?.label.toLocaleLowerCase('es')} para continuar.</span>}
 </div>;
}
