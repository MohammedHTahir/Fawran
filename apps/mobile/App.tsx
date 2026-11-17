import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, Share, StatusBar, StyleSheet, Text, TextInput, View } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import * as Clipboard from 'expo-clipboard';

type Lang = 'ar' | 'en';
type Tx = { id: string; kind: string; amount: number; createdAt: string; memo?: string | null };
type AuthSession = { id:string; created_at:string; last_used_at:string|null; expires_at:string; is_current:boolean };
type ApiError = Error & { status: number };
const API = (process.env.EXPO_PUBLIC_API_URL || 'http://10.0.2.2:3000').replace(/\/$/, '');
const C = { teal: '#08665D', tealDeep: '#064B45', lime: '#DDF477', ink: '#152824', muted: '#71817B', bg: '#F5F8F6', white: '#FFFFFF', line: '#E6EDE9', pale: '#EDF6F2', red: '#B93838', soft: '#D8E9E2' };
const T = {
  ar: { app:'فوران', tagline:'ادفع واستلم فلوسك في ثواني', phone:'رقم الموبايل', otp:'كود التأكيد', sendCode:'إرسال الكود', verify:'تأكيد', dev:'كود التجربة: 000000', balance:'الرصيد المتاح', add:'إضافة رصيد', send:'إرسال', request:'طلب', link:'رابط دفع', split:'تقسيم', recent:'آخر العمليات', home:'الرئيسية', activity:'النشاط', account:'حسابي', none:'مفيش عمليات لسه', amount:'المبلغ (ج.م)', recipient:'رقم موبايل المستلم', note:'ملاحظة (اختياري)', confirm:'تأكيد التحويل', cancel:'إلغاء', fee:'الرسوم', free:'مجاني', to:'إلى', sent:'تم الإرسال', back:'العودة للرئيسية', desc:'الوصف', create:'إنشاء الرابط', ready:'كود الدفع جاهز', copy:'نسخ الكود', copied:'تم النسخ', share:'مشاركة', linkNote:'صفحة الدفع العامة غير مفعلة بعد. استخدم الكود في بيئة الاختبار فقط.', language:'اللغة', logout:'تسجيل الخروج', sessions:'الأجهزة والجلسات', currentDevice:'هذا الجهاز', otherDevice:'جلسة أخرى', revoke:'إنهاء الجلسة', logoutAll:'تسجيل الخروج من كل الأجهزة', topup:'إضافة رصيد تجريبي', instapay:'إنستاباي', card:'بطاقة', wallet:'محفظة موبايل', prototype:'نسخة تجريبية — لا توجد أموال حقيقية', mock:'وسائل الشحن تجريبية فقط. لن يتم خصم أو إضافة أموال حقيقية.', kTopup:'شحن رصيد', kLink:'دفع عبر رابط', kSend:'تحويل صادر', kReceive:'تحويل وارد', network:'تعذر الوصول للسيرفر. تأكد أن الهاتف والكمبيوتر على نفس شبكة Wi-Fi، وأن عنوان API مضبوط على IP الكمبيوتر.', invalidPhone:'رقم الموبايل غير صحيح', invalidAmount:'المبلغ غير صحيح', funds:'الرصيد غير كافٍ', missing:'المستلم غير مسجل', session:'انتهت الجلسة، سجّل الدخول مرة أخرى', generic:'حصلت مشكلة، جرّب تاني', soon:'قريبًا', rateLimit:'طلبات كثيرة. حاول مرة أخرى لاحقًا', paymentDeclined:'لم تتم عملية الدفع', serviceUnavailable:'الخدمة غير متاحة حاليًا', invalidRequest:'راجع البيانات وحاول مرة أخرى' },
  en: { app:'Fawran', tagline:'Pay and get paid in seconds', phone:'Mobile number', otp:'Verification code', sendCode:'Send code', verify:'Verify', dev:'Development code: 000000', balance:'Available balance', add:'Add money', send:'Send', request:'Request', link:'Payment link', split:'Split', recent:'Recent activity', home:'Home', activity:'Activity', account:'Account', none:'No transactions yet', amount:'Amount (EGP)', recipient:'Recipient mobile number', note:'Note (optional)', confirm:'Confirm transfer', cancel:'Cancel', fee:'Fee', free:'Free', to:'To', sent:'Money sent', back:'Back to home', desc:'Description', create:'Create link', ready:'Payment code ready', copy:'Copy code', copied:'Copied', share:'Share', linkNote:'Public checkout is not live yet. Use this code in test environments only.', language:'Language', logout:'Log out', sessions:'Devices and sessions', currentDevice:'This device', otherDevice:'Other session', revoke:'Revoke session', logoutAll:'Log out all devices', topup:'Add test balance', instapay:'InstaPay', card:'Card', wallet:'Mobile wallet', prototype:'Prototype only — no real money', mock:'Top-up methods are simulated. No real money will be charged or credited.', kTopup:'Top-up', kLink:'Payment link', kSend:'Money sent', kReceive:'Money received', network:'Cannot reach the API at '+API+'. Put your phone and computer on the same Wi-Fi, set EXPO_PUBLIC_API_URL to your computer IPv4 address, and allow port 3000 through Windows Firewall.', invalidPhone:'Invalid mobile number', invalidAmount:'Invalid amount', funds:'Insufficient balance', missing:'Recipient is not registered', session:'Session expired. Please sign in again', generic:'Something went wrong. Try again', soon:'Coming soon', rateLimit:'Too many attempts. Please try again later', paymentDeclined:'Payment was declined', serviceUnavailable:'Service is temporarily unavailable', invalidRequest:'Please check the details and try again' }
};
const money = (n:number) => (n < 0 ? '-' : '') + Math.floor(Math.abs(n)/100).toLocaleString('en-US') + '.' + String(Math.abs(n)%100).padStart(2,'0');
const parseMoney = (s:string):number|null => { const m = /^(\d{1,7})(?:\.(\d{1,2}))?$/.exec(s.trim()); if (!m) return null; const n = Number(m[1])*100 + Number((m[2]||'').padEnd(2,'0')); return Number.isSafeInteger(n) && n > 0 ? n : null; };
const validPhone = (s:string) => /^(\+20|0020|0)1[0125]\d{8}$/.test(s.replace(/[\s-]/g,''));
const makeKey = () => 'fawran-' + Date.now() + '-' + Math.random().toString(36).slice(2,12);
let accessTokenCache: string | null = null;
let onAuthExpired: (() => void) | null = null;
let refreshInFlight: Promise<string | null> | null = null;
async function refreshAccessToken(): Promise<string | null> {
  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      const refreshToken = await SecureStore.getItemAsync('fawran.refreshToken');
      if (!refreshToken) {
        accessTokenCache = null;
        await SecureStore.deleteItemAsync('fawran.token');
        onAuthExpired?.();
        return null;
      }
      let response: Response;
      try {
        response = await fetch(API + '/auth/refresh', {
          method:'POST', headers:{'Content-Type':'application/json'},
          body:JSON.stringify({refreshToken}), signal:AbortSignal.timeout(12_000)
        });
      } catch {
        const e = new Error('network') as ApiError; e.status = 0; throw e;
      }
      if (!response.ok) {
        accessTokenCache = null;
        await Promise.all([
          SecureStore.deleteItemAsync('fawran.token'),
          SecureStore.deleteItemAsync('fawran.refreshToken')
        ]);
        onAuthExpired?.();
        return null;
      }
      const session = await response.json() as {token:string;refreshToken:string};
      accessTokenCache = session.token;
      await Promise.all([
        SecureStore.setItemAsync('fawran.token',session.token),
        SecureStore.setItemAsync('fawran.refreshToken',session.refreshToken)
      ]);
      return session.token;
    })().finally(() => { refreshInFlight = null; });
  }
  return refreshInFlight;
}
async function api<T>(path:string, token?:string|null, method='GET', body?:unknown, idem?:string):Promise<T> {
  const send = async (authToken:string|null) => {
    try {
      return await fetch(API + path, {
        method,
        headers:{'Content-Type':'application/json', ...(authToken?{Authorization:'Bearer '+authToken}:{}), ...(idem?{'Idempotency-Key':idem}:{})},
        ...(body!==undefined?{body:JSON.stringify(body)}:{})
      });
    } catch {
      const e = new Error('network') as ApiError; e.status = 0; throw e;
    }
  };
  const activeToken = accessTokenCache ?? token ?? null;
  let r = await send(activeToken);
  if (r.status === 401 && activeToken && path !== '/auth/refresh') {
    const refreshedToken = await refreshAccessToken();
    if (refreshedToken) r = await send(refreshedToken);
  }
  const data = await r.json().catch(()=>null);
  if (!r.ok) { const e = new Error(data?.message || 'Request failed') as ApiError; e.status = r.status; throw e; }
  return data as T;
}
const errorText = (e:unknown,w:typeof T.en) => {
  const err=e as ApiError, s=err?.status, message=String(err?.message||'');
  if(s===0)return w.network;
  if(s===401)return w.session;
  if(s===404)return w.missing;
  if(s===402)return w.paymentDeclined;
  if(s===422||message.toLowerCase().includes('insufficient funds'))return w.funds;
  if(s===429)return w.rateLimit;
  if(s===503)return w.serviceUnavailable;
  if(message.toLowerCase().includes('invalid egyptian mobile'))return w.invalidPhone;
  if(message.toLowerCase().includes('amount'))return w.invalidAmount;
  if(s===400)return w.invalidRequest;
  return w.generic;
};

export default function App() {
  const [lang,setLang] = useState<Lang>('ar'), [token,setToken] = useState<string|null>(null), [phone,setPhone] = useState(''), [otp,setOtp] = useState(''), [otpSent,setOtpSent] = useState(false);
  const [balance,setBalance] = useState(0), [balanceVisible,setBalanceVisible] = useState(true), [tx,setTx] = useState<Tx[]>([]), [sessions,setSessions] = useState<AuthSession[]>([]), [tab,setTab] = useState<'home'|'activity'|'account'>('home'), [page,setPage] = useState<'tabs'|'send'|'link'|'receipt'>('tabs');
  const [busy,setBusy] = useState(false), [refreshing,setRefreshing] = useState(false), [topup,setTopup] = useState(false), [amount,setAmount] = useState(''), [method,setMethod] = useState('instapay');
  const [to,setTo] = useState(''), [note,setNote] = useState(''), [linkAmount,setLinkAmount] = useState(''), [description,setDescription] = useState(''), [linkCode,setLinkCode] = useState('');
  const [receipt,setReceipt] = useState<{amount:number;to:string;at:string}|null>(null);
  const topupAttempt = useRef<{fp:string;key:string}|null>(null), transferAttempt = useRef<{fp:string;key:string}|null>(null);
  const w = T[lang], rtl = lang === 'ar';
  useEffect(() => { onAuthExpired = () => { setToken(null); setBalance(0); setTx([]); setPage('tabs'); }; return () => { onAuthExpired = null; }; }, []);
  useEffect(() => { (async()=>{ const [l,t,p] = await Promise.all([SecureStore.getItemAsync('fawran.lang'),SecureStore.getItemAsync('fawran.token'),SecureStore.getItemAsync('fawran.phone')]); if(l==='ar'||l==='en')setLang(l); if(t){accessTokenCache=t;setToken(t);setPhone(p||'');} })(); }, []);
  const refresh = async () => { if(!token)return; setRefreshing(true); try { const [a,b,s] = await Promise.all([api<{balance:number}>('/wallet',token),api<Tx[]>('/transactions',token),api<AuthSession[]>('/auth/sessions',token)]); setBalance(a.balance);setTx(b);setSessions(s); } catch(e) { if((e as ApiError).status===401){await SecureStore.deleteItemAsync('fawran.token');await SecureStore.deleteItemAsync('fawran.refreshToken');accessTokenCache=null;setToken(null);setBalance(0);setTx([]);setSessions([]);} else Alert.alert(w.generic,errorText(e,w)); } finally {setRefreshing(false);} };
  useEffect(()=>{if(token)void refresh();},[token]);
  const setLanguage = async (l:Lang) => {setLang(l);await SecureStore.setItemAsync('fawran.lang',l);};
  const login = async () => { if(!validPhone(phone)){Alert.alert(w.invalidPhone);return;} setBusy(true); try { if(!otpSent){await api('/auth/otp',null,'POST',{phone:phone.trim()});setOtpSent(true);} else {const r=await api<{token:string;refreshToken:string}>('/auth/verify',null,'POST',{phone:phone.trim(),code:otp});accessTokenCache=r.token;await Promise.all([SecureStore.setItemAsync('fawran.token',r.token),SecureStore.setItemAsync('fawran.refreshToken',r.refreshToken),SecureStore.setItemAsync('fawran.phone',phone.trim())]);setToken(r.token);} } catch(e){Alert.alert(w.generic,errorText(e,w));} finally{setBusy(false);} };
  const doTopup = async () => { const n=parseMoney(amount); if(!n){Alert.alert(w.invalidAmount);return;} const fp=n+'|'+method; if(topupAttempt.current?.fp!==fp)topupAttempt.current={fp,key:makeKey()}; setBusy(true); try {await api('/wallet/topup',token,'POST',{amount:n,method},topupAttempt.current!.key);setTopup(false);setAmount('');topupAttempt.current=null;await refresh();} catch(e){Alert.alert(w.generic,errorText(e,w));} finally{setBusy(false);} };
  const doSend = () => { const n=parseMoney(amount); if(!validPhone(to)){Alert.alert(w.invalidPhone);return;} if(!n){Alert.alert(w.invalidAmount);return;} const fp=to.trim()+'|'+n+'|'+note.trim(); if(transferAttempt.current?.fp!==fp)transferAttempt.current={fp,key:makeKey()}; Alert.alert(w.confirm,money(n)+' EGP\n'+to,[{text:w.cancel,style:'cancel'},{text:w.send,onPress:async()=>{setBusy(true);try{await api('/transfers',token,'POST',{toPhone:to.trim(),amount:n,...(note.trim()?{note:note.trim()}:{})},transferAttempt.current!.key);setReceipt({amount:n,to:to.trim(),at:new Date().toISOString()});setPage('receipt');setAmount('');setTo('');setNote('');transferAttempt.current=null;await refresh();}catch(e){Alert.alert(w.generic,errorText(e,w));}finally{setBusy(false);}}}]); };
  const doLink = async () => {const n=parseMoney(linkAmount);if(!n){Alert.alert(w.invalidAmount);return;}setBusy(true);try{const r=await api<{code:string}>('/links',token,'POST',{amount:n,...(description.trim()?{description:description.trim()}:{})});setLinkCode(r.code);}catch(e){Alert.alert(w.generic,errorText(e,w));}finally{setBusy(false);}};
  const logoutAll = async () => { try { await api('/auth/logout-all',token,'POST',{}); } catch {} await SecureStore.deleteItemAsync('fawran.token'); await SecureStore.deleteItemAsync('fawran.refreshToken'); await SecureStore.deleteItemAsync('fawran.phone'); accessTokenCache=null; setToken(null); setBalance(0); setTx([]); setSessions([]); setPage('tabs'); };
  const revokeSession = async (id:string) => { setBusy(true); try { await api('/auth/sessions/'+encodeURIComponent(id),token,'DELETE'); await refresh(); } catch(e) { Alert.alert(w.generic,errorText(e,w)); } finally { setBusy(false); } };
  const logout = async () => {try{await api('/auth/logout',token,'POST',{});}catch{}await SecureStore.deleteItemAsync('fawran.token');await SecureStore.deleteItemAsync('fawran.refreshToken');await SecureStore.deleteItemAsync('fawran.phone');accessTokenCache=null;setToken(null);setBalance(0);setTx([]);setSessions([]);setPage('tabs');};
  const txt=(s:string,style:any={})=><Text style={[S.text,{textAlign:rtl?'right':'left'},style]}>{s}</Text>;
  const label=(s:string)=>txt(s,{fontWeight:'800',fontSize:13,marginBottom:7});
  const field=(v:string,change:(s:string)=>void,placeholder:string,kb:any='default',max?:number)=><TextInput value={v} onChangeText={change} placeholder={placeholder} placeholderTextColor="#98A49F" keyboardType={kb} maxLength={max} autoCapitalize="none" style={[S.input,{textAlign:kb==='phone-pad'||kb==='numeric'||kb==='decimal-pad'?'left':rtl?'right':'left'}]}/>;
  const button=(s:string,fn:()=>void,secondary=false)=><Pressable accessibilityRole="button" accessibilityLabel={s} onPress={fn} disabled={busy} style={[S.button,secondary&&S.secondary,busy&&{opacity:.65}]}>{busy&&!secondary?<ActivityIndicator color={C.ink}/>:<Text style={[S.buttonText,secondary&&{color:C.teal}]}>{s}</Text>}</Pressable>;
  const header=(s:string)=><View style={[S.row,{flexDirection:rtl?'row-reverse':'row'}]}><Pressable onPress={()=>setPage('tabs')} style={S.back}><Text style={S.text}>‹</Text></Pressable><Text style={[S.title,{flex:1,textAlign:rtl?'right':'left'}]}>{s}</Text></View>;
  const row=(x:Tx)=><View key={x.id} style={[S.txrow,{flexDirection:rtl?'row-reverse':'row'}]}><View style={S.txicon}><Text style={{color:C.teal,fontWeight:'900'}}>{x.amount>=0?'+':'−'}</Text></View><View style={{flex:1}}>{txt(x.kind==='topup'?w.kTopup:x.kind==='link_payment'?w.kLink:x.amount>=0?w.kReceive:w.kSend,{fontWeight:'800',fontSize:13})}{txt(x.memo||new Date(x.createdAt).toLocaleString(lang==='ar'?'ar-EG':'en-GB'),{fontSize:10,color:C.muted})}</View><Text style={{fontWeight:'900',color:x.amount>=0?C.teal:C.ink}}>{x.amount>0?'+':''}{money(x.amount)}</Text></View>;
  const shell=(children:React.ReactNode)=><View style={[S.shell,{direction:rtl?'rtl':'ltr'}]}><StatusBar barStyle="dark-content" backgroundColor={C.bg}/>{children}</View>;
  const cardVisual=()=><View accessible accessibilityLabel="Fawran digital wallet illustration" style={S.visualWrap}><View style={S.visualOrb}/><View style={[S.visualCard,S.visualCardBack]}/><View style={S.visualCard}><View style={S.visualTop}><Text style={S.visualBrand}>FAWRAN</Text><Text style={S.visualSpark}>✦</Text></View><Text style={S.visualDots}>••••  ••••  ••••  2048</Text><View style={S.visualBottom}><Text style={S.visualCaption}>MOVE MONEY WITH CLARITY</Text><Text style={S.visualArrow}>↗</Text></View></View><View style={S.visualCoin}><Text style={S.visualCoinText}>ف</Text></View></View>;
  if(!token)return shell(<ScrollView contentContainerStyle={S.login}><Pressable accessibilityRole="button" onPress={()=>void setLanguage(rtl?'en':'ar')}><Text style={S.lang}>{rtl?'English':'العربية'}</Text></Pressable><View style={S.loginIntro}><View style={S.logo}><Text style={{color:C.lime,fontSize:32,fontWeight:'900'}}>ف</Text></View><Text style={S.brand}>{w.app}</Text>{txt(w.tagline,{color:C.muted,fontSize:16,marginBottom:8})}</View>{cardVisual()}<View style={S.loginForm}>{label(w.phone)}{field(phone,setPhone,'010 0000 0000','phone-pad')}{otpSent&&<>{label(w.otp)}{field(otp,setOtp,'000000','numeric',6)}{__DEV__&&txt(w.dev,{fontSize:12,color:C.muted})}</>}{button(otpSent?w.verify:w.sendCode,login)}<Text style={S.notice}>{w.prototype}</Text></View></ScrollView>);
  if(page==='send')return shell(<ScrollView contentContainerStyle={S.page}>{header(w.send)}{label(w.recipient)}{field(to,setTo,'010 0000 0000','phone-pad')}{label(w.amount)}{field(amount,setAmount,'0.00','decimal-pad')}{label(w.note)}{field(note,setNote,w.note)}{txt(w.free,{fontSize:12,color:C.muted,marginVertical:10})}{button(w.send,doSend)}</ScrollView>);
  if(page==='link')return shell(<ScrollView contentContainerStyle={S.page}>{header(w.link)}{!linkCode?<>{label(w.amount)}{field(linkAmount,setLinkAmount,'0.00','decimal-pad')}{label(w.desc)}{field(description,setDescription,w.desc)}{button(w.create,doLink)}</>:<View style={S.card}>{txt(w.ready,{fontSize:20,fontWeight:'900',textAlign:'center'})}<Text style={S.code}>{linkCode}</Text>{button(w.copy,()=>void Clipboard.setStringAsync(linkCode).then(()=>Alert.alert(w.copied)))}{button(w.share,()=>void Share.share({message:w.ready+': '+linkCode}),true)}<Text style={S.notice}>{w.linkNote}</Text></View>}</ScrollView>);
  if(page==='receipt'&&receipt)return shell(<View style={S.page}><View style={S.success}><Text style={{fontSize:32}}>✓</Text></View>{txt(w.sent,{fontSize:23,fontWeight:'900',textAlign:'center'})}<Text style={S.bigAmount}>{money(receipt.amount)} EGP</Text><View style={S.card}>{txt(w.to+': '+receipt.to)}{txt(w.fee+': '+w.free)}{txt(new Date(receipt.at).toLocaleString())}</View><View style={{flex:1}}/>{button(w.back,()=>{setPage('tabs');setTab('home');})}</View>);
  return shell(<View style={{flex:1}}>
    {tab==='home'&&<ScrollView contentContainerStyle={S.page} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={()=>void refresh()}/>}><View style={[S.row,{justifyContent:'space-between'}]}><Text style={S.brandSmall}>{w.app}</Text><Pressable onPress={()=>setTab('account')} style={S.avatar}><Text style={{color:C.teal,fontWeight:'900'}}>{phone.slice(-1)}</Text></Pressable></View><View style={S.balance}><View style={S.balanceHeader}>{txt(w.balance,{color:'#D7E8E4'})}<Pressable accessibilityRole="button" accessibilityLabel={balanceVisible?'Hide balance':'Show balance'} onPress={()=>setBalanceVisible(v=>!v)} style={S.balanceEye}><Text style={S.balanceEyeText}>{balanceVisible?'◉':'◎'}</Text></Pressable></View><Text style={S.balanceValue}>{balanceVisible?money(balance):'••••••'} <Text style={{fontSize:14}}>EGP</Text></Text>{button(w.add,()=>setTopup(true))}</View><View style={[S.row,{justifyContent:'space-between',marginVertical:20}]}>{[[w.send,'↗',()=>{setAmount('');setPage('send');}],[w.request,'↙',()=>Alert.alert(w.soon)],[w.link,'⌁',()=>{setLinkCode('');setPage('link');}],[w.split,'⊞',()=>Alert.alert(w.soon)]].map(([s,ic,fn]:any)=><Pressable key={s} onPress={fn} style={S.action}><View style={S.actionIcon}><Text style={{fontSize:22,color:C.teal}}>{ic}</Text></View><Text style={{fontSize:11,fontWeight:'800',color:C.ink}}>{s}</Text></Pressable>)}</View>{txt(w.recent,{fontSize:18,fontWeight:'900',marginBottom:10})}<View style={S.card}>{tx.length?tx.slice(0,5).map(row):<Text style={S.empty}>{w.none}</Text>}</View><Text style={S.notice}>{w.prototype}</Text></ScrollView>}
    {tab==='activity'&&<ScrollView contentContainerStyle={S.page} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={()=>void refresh()} />}>{txt(w.activity,{fontSize:22,fontWeight:'900',marginBottom:14})}<View style={S.card}>{tx.length?tx.map(row):<Text style={S.empty}>{w.none}</Text>}</View></ScrollView>}
    {tab==='account'&&<ScrollView contentContainerStyle={S.page}>{txt(w.account,{fontSize:22,fontWeight:'900',marginBottom:14})}<View style={S.card}>{txt(phone,{fontSize:17,fontWeight:'900',marginVertical:12})}{label(w.language)}<View style={S.row}><Pressable onPress={()=>void setLanguage('ar')} style={[S.langOption,rtl&&S.langSelected]}><Text style={{color:rtl?C.white:C.ink}}>العربية</Text></Pressable><Pressable onPress={()=>void setLanguage('en')} style={[S.langOption,!rtl&&S.langSelected]}><Text style={{color:!rtl?C.white:C.ink}}>English</Text></Pressable></View>{label(w.sessions)}{sessions.map(s=><View key={s.id} style={[S.txrow,{flexDirection:rtl?'row-reverse':'row'}]}><View style={{flex:1}}>{txt(s.is_current?w.currentDevice:w.otherDevice,{fontWeight:'800',fontSize:13})}{txt(new Date(s.created_at).toLocaleString(lang==='ar'?'ar-EG':'en-GB'),{fontSize:10,color:C.muted})}</View><Pressable disabled={busy} onPress={()=>Alert.alert(w.revoke,'',[{text:w.cancel,style:'cancel'},{text:w.revoke,style:'destructive',onPress:()=>void revokeSession(s.id)}])}><Text style={{color:C.red,fontWeight:'800',fontSize:12}}>{w.revoke}</Text></Pressable></View>)}{button(w.logoutAll,()=>Alert.alert(w.logoutAll,'',[{text:w.cancel,style:'cancel'},{text:w.logoutAll,style:'destructive',onPress:()=>void logoutAll()}]),true)}{button(w.logout,()=>Alert.alert(w.logout,'',[{text:w.cancel,style:'cancel'},{text:w.logout,style:'destructive',onPress:()=>void logout()}]),true)}</View><Text style={S.notice}>{w.prototype}</Text></ScrollView>}
    <View style={[S.nav,{flexDirection:rtl?'row-reverse':'row'}]}>{[[w.home,'⌂','home'],[w.activity,'▤','activity'],[w.account,'◯','account']].map(([s,ic,k]:any)=><Pressable key={k} onPress={()=>setTab(k)} style={S.navItem}><Text style={{fontSize:20,color:tab===k?C.teal:C.muted}}>{ic}</Text><Text style={{fontSize:10,color:tab===k?C.teal:C.muted,fontWeight:'800'}}>{s}</Text></Pressable>)}</View>
    {topup&&<View style={S.modal}><View style={S.modalCard}><View style={[S.row,{justifyContent:'space-between'}]}><Text style={S.title}>{w.topup}</Text><Pressable onPress={()=>setTopup(false)}><Text style={{fontSize:26}}>×</Text></Pressable></View>{label(w.amount)}{field(amount,setAmount,'0.00','decimal-pad')}<View style={S.row}>{(['instapay','card','wallet'] as const).map(m=><Pressable key={m} onPress={()=>setMethod(m)} style={[S.method,method===m&&S.methodActive]}><Text style={{fontSize:11,color:method===m?C.teal:C.muted,fontWeight:'800'}}>{w[m]}</Text></Pressable>)}</View><Text style={S.notice}>{w.mock}</Text>{button(w.add,doTopup)}</View></View>}
  </View>);
}
const S=StyleSheet.create({
 shell:{flex:1,backgroundColor:C.bg},
 login:{flexGrow:1,paddingHorizontal:24,paddingTop:30,paddingBottom:34,justifyContent:'center'},
 loginIntro:{alignItems:'flex-start'},
 loginForm:{backgroundColor:C.white,borderRadius:24,padding:20,borderWidth:1,borderColor:C.line,shadowColor:'#173B32',shadowOpacity:.06,shadowRadius:18,shadowOffset:{width:0,height:8},elevation:3},
 page:{padding:20,paddingBottom:32},
 lang:{textAlign:'right',color:C.teal,fontWeight:'900',marginBottom:22,minHeight:44,textAlignVertical:'center'},
 logo:{width:58,height:58,borderRadius:19,backgroundColor:C.teal,alignItems:'center',justifyContent:'center',marginBottom:15},
 brand:{fontSize:40,fontWeight:'900',color:C.teal,letterSpacing:-1},
 brandSmall:{fontSize:24,fontWeight:'900',color:C.teal,letterSpacing:-.5},
 text:{color:C.ink,fontSize:14},
 input:{minHeight:54,borderRadius:15,borderWidth:1,borderColor:C.line,backgroundColor:'#FBFDFC',paddingHorizontal:16,marginBottom:17,fontSize:16,color:C.ink},
 button:{minHeight:54,borderRadius:16,backgroundColor:C.lime,alignItems:'center',justifyContent:'center',padding:14,marginTop:12},
 buttonText:{color:C.ink,fontWeight:'900',fontSize:15},
 secondary:{backgroundColor:C.pale,borderWidth:1,borderColor:'#D4E8DF'},
 notice:{textAlign:'center',fontSize:12,color:C.muted,backgroundColor:C.pale,borderRadius:14,padding:13,marginTop:18,lineHeight:19},
 row:{flexDirection:'row',alignItems:'center',gap:8},
 balance:{backgroundColor:C.tealDeep,borderRadius:27,padding:24,gap:13,overflow:'hidden',shadowColor:C.tealDeep,shadowOpacity:.18,shadowRadius:18,shadowOffset:{width:0,height:10},elevation:5},
 balanceValue:{fontSize:36,fontWeight:'900',color:C.white,textAlign:'left',letterSpacing:-.8},
 balanceHeader:{flexDirection:'row',alignItems:'center',justifyContent:'space-between'},balanceEye:{width:40,height:40,borderRadius:14,backgroundColor:'rgba(255,255,255,0.12)',alignItems:'center',justifyContent:'center'},balanceEyeText:{color:C.white,fontSize:19,fontWeight:'800'},
 action:{flex:1,alignItems:'center',gap:8,minHeight:88,justifyContent:'center',backgroundColor:C.white,borderRadius:18,paddingVertical:12,borderWidth:1,borderColor:C.line},
 actionIcon:{width:48,height:48,borderRadius:16,backgroundColor:C.pale,alignItems:'center',justifyContent:'center'},
 card:{backgroundColor:C.white,borderRadius:20,borderWidth:1,borderColor:C.line,padding:16,shadowColor:'#173B32',shadowOpacity:.035,shadowRadius:12,shadowOffset:{width:0,height:5},elevation:1},
 empty:{padding:24,textAlign:'center',color:C.muted},
 txrow:{flexDirection:'row',alignItems:'center',gap:12,paddingVertical:14,borderBottomWidth:StyleSheet.hairlineWidth,borderColor:C.line},
 txicon:{width:42,height:42,borderRadius:15,backgroundColor:C.pale,alignItems:'center',justifyContent:'center'},
 nav:{backgroundColor:C.white,borderTopWidth:1,borderColor:C.line,paddingTop:10,paddingBottom:14},
 navItem:{flex:1,alignItems:'center',justifyContent:'center',gap:4,minHeight:52},
 back:{width:44,height:44,borderRadius:14,backgroundColor:C.white,alignItems:'center',justifyContent:'center'},
 title:{fontSize:20,fontWeight:'900',color:C.ink,marginBottom:16},
 code:{fontSize:26,fontWeight:'900',color:C.teal,textAlign:'center',marginVertical:20},
 success:{width:68,height:68,borderRadius:34,backgroundColor:C.lime,alignItems:'center',justifyContent:'center',alignSelf:'center',marginTop:55,marginBottom:16},
 bigAmount:{fontSize:34,fontWeight:'900',textAlign:'center',marginBottom:24},
 langOption:{flex:1,minHeight:44,alignItems:'center',justifyContent:'center',borderRadius:12,backgroundColor:C.bg},
 langSelected:{backgroundColor:C.teal},
 method:{flex:1,minHeight:48,borderRadius:13,borderWidth:1,borderColor:C.line,alignItems:'center',justifyContent:'center'},
 methodActive:{borderColor:C.teal,backgroundColor:C.pale},
 avatar:{width:42,height:42,borderRadius:21,backgroundColor:C.pale,alignItems:'center',justifyContent:'center'},
 modal:{position:'absolute',top:0,bottom:0,left:0,right:0,backgroundColor:'rgba(10,25,22,0.4)',justifyContent:'flex-end'},
 modalCard:{backgroundColor:C.white,borderTopLeftRadius:26,borderTopRightRadius:26,padding:22,paddingBottom:34,gap:12},
 visualWrap:{height:190,marginTop:12,marginBottom:22,alignItems:'center',justifyContent:'center',overflow:'hidden'},
 visualOrb:{position:'absolute',width:176,height:176,borderRadius:88,backgroundColor:'#E1F0E9',right:22,top:6},
 visualCard:{position:'absolute',width:'82%',height:132,borderRadius:22,backgroundColor:C.teal,padding:17,justifyContent:'space-between',transform:[{rotate:'-5deg'}],shadowColor:'#073F39',shadowOpacity:.22,shadowRadius:16,shadowOffset:{width:0,height:10},elevation:7},
 visualCardBack:{width:'76%',height:126,backgroundColor:'#B9D8CA',transform:[{rotate:'8deg'},{translateY:8},{translateX:8}],opacity:.9},
 visualTop:{flexDirection:'row',justifyContent:'space-between',alignItems:'center'},
 visualBrand:{color:'#EAF6F0',fontSize:11,fontWeight:'900',letterSpacing:2},
 visualSpark:{color:C.lime,fontSize:22},
 visualDots:{color:'#FFFFFF',fontSize:17,letterSpacing:1,fontWeight:'700'},
 visualBottom:{flexDirection:'row',justifyContent:'space-between',alignItems:'center'},
 visualCaption:{color:'#C5DDD3',fontSize:8,fontWeight:'800',letterSpacing:1.4},
 visualArrow:{color:C.lime,fontSize:23,fontWeight:'900'},
 visualCoin:{position:'absolute',right:28,bottom:4,width:48,height:48,borderRadius:24,backgroundColor:C.lime,borderWidth:4,borderColor:C.bg,alignItems:'center',justifyContent:'center',shadowColor:'#173B32',shadowOpacity:.16,shadowRadius:8,elevation:4},
 visualCoinText:{fontSize:20,fontWeight:'900',color:C.teal}
});
