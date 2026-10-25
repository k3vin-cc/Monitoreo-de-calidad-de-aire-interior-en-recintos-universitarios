import React,{useMemo,useState} from 'react';

export default function SearchableSelect({name,label,rows,value='',placeholder='Escribe para buscar',required=false,formatOption=x=>x.nombre,emptyLabel='Selecciona…',onChange,multiple=false,size=1,hideLabel=false}){
 const [query,setQuery]=useState('');
 const options=useMemo(()=>{
  const q=query.trim().toLocaleLowerCase('es');
  const filtered=q?rows.filter(row=>formatOption(row).toLocaleLowerCase('es').includes(q)):rows;
  const current=rows.find(row=>row.id===value);
  return current&&!filtered.some(row=>row.id===current.id)?[current,...filtered]:filtered;
 },[rows,query,value,formatOption]);
 return <label className={`searchSelectField${hideLabel?' visuallyHiddenLabel':''}`}>{label}<input type="search" value={query} onChange={e=>setQuery(e.target.value)} placeholder={placeholder} aria-label={`Buscar ${label.toLocaleLowerCase('es')}`} autoComplete="off"/><select name={name} value={value} required={required} onChange={onChange} multiple={multiple} size={multiple?size:undefined}>
  {!multiple&&<option value="" disabled={required}>{emptyLabel}</option>}
  {options.slice(0,250).map(row=><option key={row.id} value={row.id}>{formatOption(row)}</option>)}
 </select><small>{options.length>250?`Mostrando 250 de ${options.length}; escribe más para acotar.`:`${options.length} ${options.length===1?'resultado':'resultados'}`}</small></label>;
}
