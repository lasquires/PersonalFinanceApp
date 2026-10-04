export type ReviewKind = 'weekly' | 'monthly';
export type ReviewPeriod = { kind:ReviewKind; period_start:string; period_end:string; complete:boolean; timezone:string };
export function validDate(value:string) {
 return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value+'T12:00:00Z')) && new Date(value+'T12:00:00Z').toISOString().slice(0,10)===value;
}
export function calendarDate(now:Date,timezone:string) {
 const parts=new Intl.DateTimeFormat('en-US',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);
 const part=(type:string)=>parts.find(p=>p.type===type)!.value;
 return `${part('year')}-${part('month')}-${part('day')}`;
}
export function shiftDate(date:string,days:number) { const d=new Date(date+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10); }
export function periodEnd(kind:ReviewKind,start:string) {
 if(kind==='weekly') return shiftDate(start,6);
 const d=new Date(start+'T12:00:00Z');d.setUTCMonth(d.getUTCMonth()+1,0);return d.toISOString().slice(0,10);
}
export function reviewPeriod(kind:ReviewKind,start:string,timezone='America/New_York',now=new Date()):ReviewPeriod {
 if(!['weekly','monthly'].includes(kind)||!validDate(start)||start<'2000-01-01')throw new Error('Choose a valid reporting date.');
 if(kind==='weekly' && new Date(start+'T12:00:00Z').getUTCDay()!==1)throw new Error('Weekly reviews start on Monday.');
 if(kind==='monthly' && start.slice(8)!=='01')throw new Error('Monthly reviews start on the first.');
 const today=calendarDate(now,timezone);
 if(start>today)throw new Error('A reporting period cannot start in the future.');
 const end=periodEnd(kind,start);
 return {kind,period_start:start,period_end:end,complete:end<today,timezone};
}
export function previousReviewPeriod(kind:ReviewKind,timezone='America/New_York',now=new Date()):ReviewPeriod {
 const today=calendarDate(now,timezone); let start:string;
 if(kind==='weekly') {const weekday=new Date(today+'T12:00:00Z').getUTCDay();start=shiftDate(today,-((weekday+6)%7)-7);}
 else {const d=new Date(today.slice(0,7)+'-01T12:00:00Z');d.setUTCMonth(d.getUTCMonth()-1);start=d.toISOString().slice(0,10);}
 return reviewPeriod(kind,start,timezone,now);
}
