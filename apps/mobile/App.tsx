import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, Share, StatusBar, StyleSheet, Text, TextInput, View } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import * as Clipboard from 'expo-clipboard';

type Lang = 'ar' | 'en';
type MarketCode = 'AE'|'EG'|'SA'|'GB'|'US';
const MARKETS: {code:MarketCode;label:string;currency:string}[] = [
  {code:'AE',label:'UAE',currency:'AED'},{code:'EG',label:'Egypt',currency:'EGP'},
  {code:'SA',label:'Saudi',currency:'SAR'},{code:'GB',label:'UK',currency:'GBP'},
  {code:'US',label:'US',currency:'USD'},
];
type Tx = { id: string; kind: string; amount: number; currency?: string; createdAt: string; memo?: string | null };
type WalletSummary = { accountId:string; currency:string; balance:number; unit:string; createdAt:string };
type AuthSession = { id:string; created_at:string; last_used_at:string|null; expires_at:string; is_current:boolean };
type RewardSummary = { unit:string; pointsBalance:number; lifetimeEarnedPoints:number; tier:string; referralCode:string; history:Array<{id:string;kind:string;points:number;reference?:string|null;createdAt:string;expiresAt?:string|null}> };
type MerchantSummary = { id:string; display_name:string; country_code:string; currency:string; kyb_status:string; status:string; role:string };
type MerchantDetails = { merchantId:string; legalName:string; displayName:string; countryCode:string; currency:string; kybStatus:string; status:string; role:string; paymentsEnabled:boolean; accounts:Array<{currency:string;balance:number;settlementStatus:string}> };
type ApiError = Error & { status: number };
const API = (process.env.EXPO_PUBLIC_API_URL || 'http://10.0.2.2:3000').replace(/\/$/, '');
const C = { teal: '#08665D', tealDeep: '#064B45', lime: '#DDF477', ink: '#152824', muted: '#71817B', bg: '#F5F8F6', white: '#FFFFFF', line: '#E6EDE9', pale: '#EDF6F2', red: '#B93838', soft: '#D8E9E2' };
const T = {
  ar: { app:'فوران', tagline:'ادفع واستلم فلوسك في ثواني', phone:'رقم الموبايل', otp:'كود التأكيد', sendCode:'إرسال الكود', verify:'تأكيد', dev:'كود التجربة: 000000', balance:'الرصيد المتاح', add:'إضافة رصيد', send:'إرسال', request:'طلب', link:'رابط دفع', split:'تقسيم', recent:'آخر العمليات', home:'الرئيسية', activity:'النشاط', account:'حسابي', none:'مفيش عمليات لسه', thisMonth:'ملخص الشهر', moneyIn:'دخل', moneyOut:'مصروفات', all:'الكل', incoming:'الوارد', outgoing:'الصادر', searchTransactions:'ابحث في العمليات', transactionDetails:'تفاصيل العملية', transactionId:'رقم العملية', transactionType:'نوع العملية', transactionDate:'التاريخ والوقت', transactionNote:'ملاحظة', recordedAmount:'المبلغ المسجل', noNote:'لا توجد ملاحظة', copyReceipt:'نسخ التفاصيل', receiptShared:'تفاصيل العملية', receiptCopy:'نسخ الإيصال', profile:'الملف الشخصي', security:'الأمان', activeSessions:'الجلسات النشطة', sessionHelp:'راجع الأجهزة التي سجلت الدخول منها وأنهِ أي جلسة لا تعرفها.', signOutHelp:'سيتم طلب التأكيد قبل إنهاء الجلسة أو تسجيل الخروج من جميع الأجهزة.', appVersion:'فوران • نسخة تجريبية', amount:'المبلغ', recipient:'رقم موبايل المستلم', note:'ملاحظة (اختياري)', confirm:'تأكيد التحويل', cancel:'إلغاء', fee:'الرسوم', free:'مجاني', to:'إلى', sent:'تم الإرسال', back:'العودة للرئيسية', desc:'الوصف', create:'إنشاء الرابط', ready:'كود الدفع جاهز', copy:'نسخ الكود', copied:'تم النسخ', share:'مشاركة', linkNote:'صفحة الدفع العامة غير مفعلة بعد. استخدم الكود في بيئة الاختبار فقط.', language:'اللغة', logout:'تسجيل الخروج', sessions:'الأجهزة والجلسات', currentDevice:'هذا الجهاز', otherDevice:'جلسة أخرى', revoke:'إنهاء الجلسة', logoutAll:'تسجيل الخروج من كل الأجهزة', topup:'إضافة رصيد تجريبي', instapay:'إنستاباي', card:'بطاقة', wallet:'محفظة موبايل', prototype:'نسخة تجريبية — لا توجد أموال حقيقية', mock:'وسائل الشحن تجريبية فقط. لن يتم خصم أو إضافة أموال حقيقية.', kTopup:'شحن رصيد', kLink:'دفع عبر رابط', kSend:'تحويل صادر', kReceive:'تحويل وارد', network:'تعذر الوصول للسيرفر. تأكد أن الهاتف والكمبيوتر على نفس شبكة Wi-Fi، وأن عنوان API مضبوط على IP الكمبيوتر.', invalidPhone:'رقم الموبايل غير صحيح', invalidAmount:'المبلغ غير صحيح', funds:'الرصيد غير كافٍ', missing:'المستلم غير مسجل', session:'انتهت الجلسة، سجّل الدخول مرة أخرى', generic:'حصلت مشكلة، جرّب تاني', soon:'قريبًا', rateLimit:'طلبات كثيرة. حاول مرة أخرى لاحقًا', paymentDeclined:'لم تتم عملية الدفع', serviceUnavailable:'الخدمة غير متاحة حاليًا', invalidRequest:'راجع البيانات وحاول مرة أخرى' },
  en: { app:'Fawran', tagline:'Pay and get paid in seconds', phone:'Mobile number', otp:'Verification code', sendCode:'Send code', verify:'Verify', dev:'Development code: 000000', balance:'Available balance', add:'Add money', send:'Send', request:'Request', link:'Payment link', split:'Split', recent:'Recent activity', home:'Home', activity:'Activity', account:'Account', none:'No transactions yet', thisMonth:'This month', moneyIn:'Money in', moneyOut:'Money out', all:'All', incoming:'Incoming', outgoing:'Outgoing', searchTransactions:'Search transactions', transactionDetails:'Transaction details', transactionId:'Transaction ID', transactionType:'Transaction type', transactionDate:'Date and time', transactionNote:'Note', recordedAmount:'Recorded amount', noNote:'No note added', copyReceipt:'Copy details', receiptShared:'Transaction details', receiptCopy:'Copy receipt', profile:'Profile', security:'Security', activeSessions:'Active sessions', sessionHelp:'Review devices signed in to your account and revoke any session you do not recognise.', signOutHelp:'You will be asked to confirm before ending a session or signing out everywhere.', appVersion:'Fawran • Prototype', amount:'Amount', recipient:'Recipient mobile number', note:'Note (optional)', confirm:'Confirm transfer', cancel:'Cancel', fee:'Fee', free:'Free', to:'To', sent:'Money sent', back:'Back to home', desc:'Description', create:'Create link', ready:'Payment code ready', copy:'Copy code', copied:'Copied', share:'Share', linkNote:'Public checkout is not live yet. Use this code in test environments only.', language:'Language', logout:'Log out', sessions:'Devices and sessions', currentDevice:'This device', otherDevice:'Other session', revoke:'Revoke session', logoutAll:'Log out all devices', topup:'Add test balance', instapay:'InstaPay', card:'Card', wallet:'Mobile wallet', prototype:'Prototype only — no real money', mock:'Top-up methods are simulated. No real money will be charged or credited.', kTopup:'Top-up', kLink:'Payment link', kSend:'Money sent', kReceive:'Money received', network:'Cannot reach the API at '+API+'. Put your phone and computer on the same Wi-Fi, set EXPO_PUBLIC_API_URL to your computer IPv4 address, and allow port 3000 through Windows Firewall.', invalidPhone:'Invalid mobile number', invalidAmount:'Invalid amount', funds:'Insufficient balance', missing:'Recipient is not registered', session:'Session expired. Please sign in again', generic:'Something went wrong. Try again', soon:'Coming soon', rateLimit:'Too many attempts. Please try again later', paymentDeclined:'Payment was declined', serviceUnavailable:'Service is temporarily unavailable', invalidRequest:'Please check the details and try again' }
};
const money = (n:number) => (n < 0 ? '-' : '') + Math.floor(Math.abs(n)/100).toLocaleString('en-US') + '.' + String(Math.abs(n)%100).padStart(2,'0');
const parseMoney = (s:string):number|null => { const m = /^(\d{1,7})(?:\.(\d{1,2}))?$/.exec(s.trim()); if (!m) return null; const n = Number(m[1])*100 + Number((m[2]||'').padEnd(2,'0')); return Number.isSafeInteger(n) && n > 0 ? n : null; };
const validPhone = (s:string, countryCode:MarketCode='EG') => {
  const raw=s.trim();
  const digits=raw.replace(/[^0-9]/g,'');
  const rules:Record<MarketCode,{dial:string;length:number;first:string;second?:string;localZero:boolean}> = {
    EG:{dial:'20',length:10,first:'1',second:'0125',localZero:true},
    AE:{dial:'971',length:9,first:'5',localZero:true},
    SA:{dial:'966',length:9,first:'5',localZero:true},
    GB:{dial:'44',length:10,first:'7',localZero:true},
    US:{dial:'1',length:10,first:'23456789',localZero:false}
  };
  const rule=rules[countryCode];
  let national=digits;
  if(raw.startsWith('+')) {
    if(!digits.startsWith(rule.dial)) return false;
    national=digits.slice(rule.dial.length);
  } else if(raw.startsWith('00')) {
    if(!digits.startsWith('00'+rule.dial)) return false;
    national=digits.slice(2+rule.dial.length);
  } else if(rule.localZero && national.startsWith('0')) {
    national=national.slice(1);
  } else if(!rule.localZero && national.startsWith(rule.dial) && national.length===rule.dial.length+rule.length) {
    national=national.slice(rule.dial.length);
  }
  if(national.length!==rule.length || !rule.first.includes(national[0]??'')) return false;
  return !rule.second || rule.second.includes(national[1]??'');
};
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
  if(message.toLowerCase().includes('invalid mobile number')||message.toLowerCase().includes('invalid egyptian mobile'))return w.invalidPhone;
  if(message.toLowerCase().includes('amount'))return w.invalidAmount;
  if(s===400)return w.invalidRequest;
  return w.generic;
};

export default function App() {
  const [lang,setLang] = useState<Lang>('ar'), [token,setToken] = useState<string|null>(null), [phone,setPhone] = useState(''), [otp,setOtp] = useState(''), [otpSent,setOtpSent] = useState(false), [countryCode,setCountryCode] = useState<MarketCode>('EG'), [recipientCountryCode,setRecipientCountryCode] = useState<MarketCode>('EG');
  const [balance,setBalance] = useState(0), [balanceVisible,setBalanceVisible] = useState(true), [tx,setTx] = useState<Tx[]>([]), [currency,setCurrency] = useState('EGP'), [wallets,setWallets] = useState<WalletSummary[]>([]), [sessions,setSessions] = useState<AuthSession[]>([]), [tab,setTab] = useState<'home'|'activity'|'account'>('home'), [activityFilter,setActivityFilter] = useState<'all'|'in'|'out'>('all'), [activitySearch,setActivitySearch] = useState(''), [page,setPage] = useState<'tabs'|'send'|'link'|'receipt'|'transaction'|'rewards'|'business'>('tabs'), [selectedTx,setSelectedTx] = useState<Tx|null>(null);
  const [busy,setBusy] = useState(false), [refreshing,setRefreshing] = useState(false), [topup,setTopup] = useState(false), [amount,setAmount] = useState(''), [method,setMethod] = useState('instapay');
  const [to,setTo] = useState(''), [note,setNote] = useState(''), [linkAmount,setLinkAmount] = useState(''), [description,setDescription] = useState(''), [linkCode,setLinkCode] = useState('');
  const [receipt,setReceipt] = useState<{amount:number;currency:string;to:string;at:string}|null>(null);
  const [rewards,setRewards] = useState<RewardSummary|null>(null), [referralInput,setReferralInput] = useState('');
  const [merchants,setMerchants] = useState<MerchantSummary[]>([]), [activeMerchant,setActiveMerchant] = useState<MerchantDetails|null>(null);
  const [merchantOffers,setMerchantOffers] = useState<any[]>([]), [merchantCampaigns,setMerchantCampaigns] = useState<any[]>([]);
  const [merchantLegalName,setMerchantLegalName] = useState(''), [merchantDisplayName,setMerchantDisplayName] = useState('');
  const [registrationNumber,setRegistrationNumber] = useState(''), [merchantLinkAmount,setMerchantLinkAmount] = useState('');
  const [merchantOfferName,setMerchantOfferName] = useState(''), [merchantCampaignName,setMerchantCampaignName] = useState('');
  const [merchantCampaignBudget,setMerchantCampaignBudget] = useState(''), [merchantLinkCode,setMerchantLinkCode] = useState('');
  const topupAttempt = useRef<{fp:string;key:string}|null>(null), transferAttempt = useRef<{fp:string;key:string}|null>(null);
  const w = T[lang], rtl = lang === 'ar';
  const monthTx = tx.filter(x=>{const d=new Date(x.createdAt),now=new Date();return d.getFullYear()===now.getFullYear()&&d.getMonth()===now.getMonth();});
  const monthIn = monthTx.filter(x=>x.amount>0).reduce((n,x)=>n+x.amount,0);
  const monthOut = Math.abs(monthTx.filter(x=>x.amount<0).reduce((n,x)=>n+x.amount,0));
  const activityTx = tx.filter(x=>(activityFilter==='all'||(activityFilter==='in'?x.amount>=0:x.amount<0))&&(!activitySearch.trim()||[x.kind,x.memo||''].join(' ').toLocaleLowerCase().includes(activitySearch.trim().toLocaleLowerCase())));
  useEffect(() => { onAuthExpired = () => { setToken(null); setBalance(0); setTx([]); setPage('tabs'); }; return () => { onAuthExpired = null; }; }, []);
  useEffect(() => { (async()=>{ const [l,t,p,cc,cur,defaultCur] = await Promise.all([SecureStore.getItemAsync('fawran.lang'),SecureStore.getItemAsync('fawran.token'),SecureStore.getItemAsync('fawran.phone'),SecureStore.getItemAsync('fawran.countryCode'),SecureStore.getItemAsync('fawran.currency'),SecureStore.getItemAsync('fawran.defaultCurrency')]); if(l==='ar'||l==='en')setLang(l); if(cc&&['AE','EG','SA','GB','US'].includes(cc)){setCountryCode(cc as MarketCode);setRecipientCountryCode(cc as MarketCode);} if(cur&&['AED','EGP','SAR','GBP','USD'].includes(cur))setCurrency(cur); else if(defaultCur&&['AED','EGP','SAR','GBP','USD'].includes(defaultCur))setCurrency(defaultCur); if(t){accessTokenCache=t;setToken(t);setPhone(p||'');} })(); }, []);
  const refresh = async () => { if(!token)return; setRefreshing(true); try { const [a,b,s,ws,r,m] = await Promise.all([api<{balance:number}>('/wallet?currency='+encodeURIComponent(currency),token),api<Tx[]>('/transactions?currency='+encodeURIComponent(currency),token),api<AuthSession[]>('/auth/sessions',token),api<WalletSummary[]>('/wallets',token),api<RewardSummary>('/rewards',token),api<MerchantSummary[]>('/merchants/me',token)]); setBalance(a.balance);setTx(b);setSessions(s);setWallets(ws);setRewards(r);setMerchants(m); } catch(e) { if((e as ApiError).status===401){await SecureStore.deleteItemAsync('fawran.token');await SecureStore.deleteItemAsync('fawran.refreshToken');accessTokenCache=null;setToken(null);setBalance(0);setTx([]);setWallets([]);setSessions([]);setRewards(null);setMerchants([]);setActiveMerchant(null);} else Alert.alert(w.generic,errorText(e,w)); } finally {setRefreshing(false);} };
  useEffect(()=>{if(token)void refresh();},[token,currency]);
  const loadMerchant = async (id:string) => {
    if(!token)return;
    setBusy(true);
    try {
      const [details,offers,campaigns] = await Promise.all([
        api<MerchantDetails>('/merchants/'+id,token),
        api<any[]>('/merchants/'+id+'/offers',token),
        api<any[]>('/merchants/'+id+'/campaigns',token)
      ]);
      setActiveMerchant(details);setMerchantOffers(offers);setMerchantCampaigns(campaigns);
    } catch(e) { Alert.alert(w.generic,errorText(e,w)); }
    finally { setBusy(false); }
  };
  const openBusiness = () => { setPage('business'); if(merchants[0])void loadMerchant(merchants[0].id); };
  const createMerchant = async () => {
    if(!merchantLegalName.trim()||!merchantDisplayName.trim()){Alert.alert(w.invalidRequest);return;}
    const market=MARKETS.find(m=>m.code===countryCode)!;
    setBusy(true);
    try {
      const created=await api<{merchantId:string}>('/merchants',token,'POST',{
        legalName:merchantLegalName.trim(),displayName:merchantDisplayName.trim(),
        countryCode:market.code,currency:market.currency
      });
      setMerchantLegalName('');setMerchantDisplayName('');
      const list=await api<MerchantSummary[]>('/merchants/me',token);
      setMerchants(list);await loadMerchant(created.merchantId);
    } catch(e) { Alert.alert(w.generic,errorText(e,w)); }
    finally { setBusy(false); }
  };
  const submitKyb = async () => {
    if(!activeMerchant||registrationNumber.trim().length<2){Alert.alert(w.invalidRequest);return;}
    setBusy(true);
    try {
      await api('/merchants/'+activeMerchant.merchantId+'/kyb/submit',token,'POST',{
        registrationNumber:registrationNumber.trim(),
        documentTypes:['trade_license','beneficial_owner_id','proof_of_address']
      });
      setRegistrationNumber('');await loadMerchant(activeMerchant.merchantId);await refresh();
    } catch(e) { Alert.alert(w.generic,errorText(e,w)); }
    finally { setBusy(false); }
  };
  const createMerchantAccount = async () => {
    if(!activeMerchant)return;
    setBusy(true);
    try { await api('/merchants/'+activeMerchant.merchantId+'/accounts',token,'POST',{currency});await loadMerchant(activeMerchant.merchantId); }
    catch(e){Alert.alert(w.generic,errorText(e,w));}
    finally{setBusy(false);}
  };
  const createMerchantPaymentLink = async () => {
    if(!activeMerchant)return;
    const n=parseMoney(merchantLinkAmount);if(!n){Alert.alert(w.invalidAmount);return;}
    setBusy(true);
    try {
      const result=await api<{code:string;checkoutPath:string;qrPayload:string}>('/merchants/'+activeMerchant.merchantId+'/payment-links',token,'POST',{
        amount:n,currency:activeMerchant.currency,description:'Merchant checkout'
      });
      setMerchantLinkCode(result.code);
      await Clipboard.setStringAsync(result.checkoutPath);
      Alert.alert(w.ready,result.checkoutPath+'\n'+w.copied);
      setMerchantLinkAmount('');
    } catch(e){Alert.alert(w.generic,errorText(e,w));}
    finally{setBusy(false);}
  };
  const createMerchantOffer = async () => {
    if(!activeMerchant||!merchantOfferName.trim())return;
    setBusy(true);
    try { await api('/merchants/'+activeMerchant.merchantId+'/offers',token,'POST',{name:merchantOfferName.trim()});setMerchantOfferName('');await loadMerchant(activeMerchant.merchantId); }
    catch(e){Alert.alert(w.generic,errorText(e,w));}
    finally{setBusy(false);}
  };
  const createMerchantCampaign = async () => {
    if(!activeMerchant||!merchantCampaignName.trim())return;
    const budget=parseMoney(merchantCampaignBudget);if(!budget){Alert.alert(w.invalidAmount);return;}
    setBusy(true);
    try { await api('/merchants/'+activeMerchant.merchantId+'/campaigns',token,'POST',{
      name:merchantCampaignName.trim(),currency:activeMerchant.currency,budgetMinor:budget,pointsPerMinor:1
    });setMerchantCampaignName('');setMerchantCampaignBudget('');await loadMerchant(activeMerchant.merchantId); }
    catch(e){Alert.alert(w.generic,errorText(e,w));}
    finally{setBusy(false);}
  };
  const claimReferral = async () => {
    const code=referralInput.trim().toUpperCase();if(!/^[A-F0-9]{16}$/.test(code)){Alert.alert(w.invalidRequest);return;}
    setBusy(true);
    try { await api('/rewards/referrals/claim',token,'POST',{code});setReferralInput('');await refresh();Alert.alert(w.copied); }
    catch(e){Alert.alert(w.generic,errorText(e,w));}
    finally{setBusy(false);}
  };
  const createCurrencyWallet = async (code:string) => { if(wallets.some(x=>x.currency===code)){setCurrency(code);await SecureStore.setItemAsync('fawran.currency',code);return;} setBusy(true); try { await api('/wallets',token,'POST',{currency:code}); setCurrency(code);await SecureStore.setItemAsync('fawran.currency',code); } catch(e) { Alert.alert(w.generic,errorText(e,w)); } finally { setBusy(false); } };
  const setLanguage = async (l:Lang) => {setLang(l);await SecureStore.setItemAsync('fawran.lang',l);};
  const login = async () => { if(!validPhone(phone,countryCode)){Alert.alert(w.invalidPhone);return;} setBusy(true); try { if(!otpSent){await api('/auth/otp',null,'POST',{phone:phone.trim(),countryCode});setOtpSent(true);} else {const r=await api<{token:string;refreshToken:string;countryCode:MarketCode;defaultCurrency:string}>('/auth/verify',null,'POST',{phone:phone.trim(),code:otp,countryCode});accessTokenCache=r.token;setCountryCode(r.countryCode);setRecipientCountryCode(r.countryCode);setCurrency(r.defaultCurrency);await Promise.all([SecureStore.setItemAsync('fawran.token',r.token),SecureStore.setItemAsync('fawran.refreshToken',r.refreshToken),SecureStore.setItemAsync('fawran.phone',phone.trim()),SecureStore.setItemAsync('fawran.countryCode',r.countryCode),SecureStore.setItemAsync('fawran.defaultCurrency',r.defaultCurrency),SecureStore.setItemAsync('fawran.currency',r.defaultCurrency)]);setToken(r.token);} } catch(e){Alert.alert(w.generic,errorText(e,w));} finally{setBusy(false);} };
  const doTopup = async () => { if(currency!=='EGP'){Alert.alert(w.invalidRequest);return;} const n=parseMoney(amount); if(!n){Alert.alert(w.invalidAmount);return;} const fp=n+'|'+method; if(topupAttempt.current?.fp!==fp)topupAttempt.current={fp,key:makeKey()}; setBusy(true); try {await api('/wallet/topup',token,'POST',{amount:n,method},topupAttempt.current!.key);setTopup(false);setAmount('');topupAttempt.current=null;await refresh();} catch(e){Alert.alert(w.generic,errorText(e,w));} finally{setBusy(false);} };
  const doSend = () => { const n=parseMoney(amount); if(!validPhone(to,recipientCountryCode)){Alert.alert(w.invalidPhone);return;} if(!n){Alert.alert(w.invalidAmount);return;} const fp=recipientCountryCode+'|'+to.trim()+'|'+n+'|'+currency+'|'+note.trim(); if(transferAttempt.current?.fp!==fp)transferAttempt.current={fp,key:makeKey()}; Alert.alert(w.confirm,money(n)+' '+currency+'\n'+to,[{text:w.cancel,style:'cancel'},{text:w.send,onPress:async()=>{setBusy(true);try{await api('/transfers',token,'POST',{toPhone:to.trim(),countryCode:recipientCountryCode,amount:n,currency,...(note.trim()?{note:note.trim()}:{})},transferAttempt.current!.key);setReceipt({amount:n,currency,to:to.trim(),at:new Date().toISOString()});setPage('receipt');setAmount('');setTo('');setNote('');transferAttempt.current=null;await refresh();}catch(e){Alert.alert(w.generic,errorText(e,w));}finally{setBusy(false);}}}]); };
  const doLink = async () => {const n=parseMoney(linkAmount);if(!n){Alert.alert(w.invalidAmount);return;}setBusy(true);try{const r=await api<{code:string}>('/links',token,'POST',{amount:n,currency,...(description.trim()?{description:description.trim()}:{})});setLinkCode(r.code);}catch(e){Alert.alert(w.generic,errorText(e,w));}finally{setBusy(false);}};
  const logoutAll = async () => { try { await api('/auth/logout-all',token,'POST',{}); } catch {} await SecureStore.deleteItemAsync('fawran.token'); await SecureStore.deleteItemAsync('fawran.refreshToken'); await SecureStore.deleteItemAsync('fawran.phone'); accessTokenCache=null; setToken(null); setBalance(0); setTx([]); setSessions([]); setPage('tabs'); };
  const revokeSession = async (id:string) => { setBusy(true); try { await api('/auth/sessions/'+encodeURIComponent(id),token,'DELETE'); await refresh(); } catch(e) { Alert.alert(w.generic,errorText(e,w)); } finally { setBusy(false); } };
  const logout = async () => {try{await api('/auth/logout',token,'POST',{});}catch{}await SecureStore.deleteItemAsync('fawran.token');await SecureStore.deleteItemAsync('fawran.refreshToken');await SecureStore.deleteItemAsync('fawran.phone');accessTokenCache=null;setToken(null);setBalance(0);setTx([]);setSessions([]);setPage('tabs');};
  const txt=(s:string,style:any={})=><Text style={[S.text,{textAlign:rtl?'right':'left'},style]}>{s}</Text>;
  const label=(s:string)=>txt(s,{fontWeight:'800',fontSize:13,marginBottom:7});
  const field=(v:string,change:(s:string)=>void,placeholder:string,kb:any='default',max?:number)=><TextInput value={v} onChangeText={change} placeholder={placeholder} placeholderTextColor="#98A49F" keyboardType={kb} maxLength={max} autoCapitalize="none" style={[S.input,{textAlign:kb==='phone-pad'||kb==='numeric'||kb==='decimal-pad'?'left':rtl?'right':'left'}]}/>;
  const button=(s:string,fn:()=>void,secondary=false)=><Pressable accessibilityRole="button" accessibilityLabel={s} onPress={fn} disabled={busy} style={[S.button,secondary&&S.secondary,busy&&{opacity:.65}]}>{busy&&!secondary?<ActivityIndicator color={C.ink}/>:<Text style={[S.buttonText,secondary&&{color:C.teal}]}>{s}</Text>}</Pressable>;
  const header=(s:string)=><View style={[S.row,{flexDirection:rtl?'row-reverse':'row'}]}><Pressable accessibilityRole="button" accessibilityLabel={w.back} onPress={()=>setPage('tabs')} style={S.back}><Text style={S.text}>‹</Text></Pressable><Text style={[S.title,{flex:1,textAlign:rtl?'right':'left'}]}>{s}</Text></View>;
  const detailLine=(k:string,v:string)=><View style={[S.detailLine,{flexDirection:rtl?'row-reverse':'row'}]}><Text style={S.detailKey}>{k}</Text><Text selectable style={[S.detailValue,{textAlign:rtl?'left':'right'}]}>{v}</Text></View>;
  const row=(x:Tx)=><Pressable key={x.id} accessibilityRole="button" accessibilityLabel={w.transactionDetails+' '+money(x.amount)} onPress={()=>{setSelectedTx(x);setPage('transaction');}} style={[S.txrow,{flexDirection:rtl?'row-reverse':'row'}]}><View style={S.txicon}><Text style={{color:C.teal,fontWeight:'900'}}>{x.amount>=0?'+':'−'}</Text></View><View style={{flex:1}}>{txt(x.kind==='topup'?w.kTopup:x.kind==='link_payment'?w.kLink:x.amount>=0?w.kReceive:w.kSend,{fontWeight:'800',fontSize:13})}{txt(x.memo||new Date(x.createdAt).toLocaleString(lang==='ar'?'ar-EG':'en-GB'),{fontSize:10,color:C.muted})}</View><View style={{alignItems:'flex-end',gap:3}}><Text style={{fontWeight:'900',color:x.amount>=0?C.teal:C.ink}}>{x.amount>0?'+':''}{money(x.amount)} <Text style={{fontSize:10,color:C.muted}}>{x.currency||currency}</Text></Text><Text style={{color:C.muted,fontSize:12}}>›</Text></View></Pressable>;
  const shell=(children:React.ReactNode)=><View style={[S.shell,{direction:rtl?'rtl':'ltr'}]}><StatusBar barStyle="dark-content"/>{children}</View>;
  const cardVisual=()=><View accessible accessibilityLabel="Fawran digital wallet illustration" style={S.visualWrap}><View style={S.visualOrb}/><View style={[S.visualCard,S.visualCardBack]}/><View style={S.visualCard}><View style={S.visualTop}><Text style={S.visualBrand}>FAWRAN</Text><Text style={S.visualSpark}>✦</Text></View><Text style={S.visualDots}>••••  ••••  ••••  2048</Text><View style={S.visualBottom}><Text style={S.visualCaption}>MOVE MONEY WITH CLARITY</Text><Text style={S.visualArrow}>↗</Text></View></View><View style={S.visualCoin}><Text style={S.visualCoinText}>ف</Text></View></View>;
  if(!token)return shell(<ScrollView contentContainerStyle={S.login}><Pressable accessibilityRole="button" onPress={()=>void setLanguage(rtl?'en':'ar')}><Text style={S.lang}>{rtl?'English':'العربية'}</Text></Pressable><View style={S.loginIntro}><View style={S.logo}><Text style={{color:C.lime,fontSize:32,fontWeight:'900'}}>ف</Text></View><Text style={S.brand}>{w.app}</Text>{txt(w.tagline,{color:C.muted,fontSize:16,marginBottom:8})}</View>{cardVisual()}<View style={S.loginForm}>{label(w.phone)}{<View style={[S.row,{flexWrap:'wrap',marginBottom:12}]}>{MARKETS.map(m=><Pressable key={m.code} accessibilityRole="button" accessibilityState={{selected:countryCode===m.code}} onPress={()=>{setCountryCode(m.code);setRecipientCountryCode(m.code);setOtpSent(false);setOtp('');}} style={{paddingHorizontal:11,paddingVertical:8,borderRadius:12,backgroundColor:countryCode===m.code?C.teal:C.pale}}><Text style={{fontSize:11,fontWeight:'900',color:countryCode===m.code?C.white:C.teal}}>{m.label} · {m.code}</Text></Pressable>)}</View>}{field(phone,setPhone,countryCode==='EG'?'010 0000 0000':countryCode==='AE'||countryCode==='SA'?'050 000 0000':countryCode==='GB'?'07123 456789':'202 555 0123','phone-pad')}{otpSent&&<>{label(w.otp)}{field(otp,setOtp,'000000','numeric',6)}{__DEV__&&txt(w.dev,{fontSize:12,color:C.muted})}</>}{button(otpSent?w.verify:w.sendCode,login)}<Text style={S.notice}>{w.prototype}</Text></View></ScrollView>);
  if(page==='rewards')return shell(<ScrollView contentContainerStyle={S.page}>{header(w.rewards)}<View style={S.balance}><Text style={{color:'#D7E8E4',fontSize:13,fontWeight:'800'}}>{w.points}</Text><Text style={{fontSize:36,fontWeight:'900',color:C.white,marginTop:8}}>{rewards?.pointsBalance?.toLocaleString('en-US')||'0'} <Text style={{fontSize:13}}>POINTS</Text></Text><Text style={{color:'#D7E8E4',fontSize:12,marginTop:8}}>{w.tier}: {rewards?.tier||'starter'}</Text></View><View style={S.card}>{txt(w.referralCode,{fontSize:13,fontWeight:'900',marginBottom:8})}<Text selectable style={S.code}>{rewards?.referralCode||'—'}</Text>{button(w.copy,()=>void Clipboard.setStringAsync(rewards?.referralCode||'').then(()=>Alert.alert(w.copied)),true)}{label(w.referralPlaceholder)}{field(referralInput,setReferralInput,'A1B2C3D4E5F60718','default',16)}{button(w.claimReferral,claimReferral)}<Text style={S.notice}>{w.prototype}</Text></View><View style={S.sectionHeading}>{txt(w.history,{fontSize:18,fontWeight:'900'})}</View><View style={S.card}>{rewards?.history?.length?rewards.history.map(item=><View key={item.id} style={[S.txrow,{flexDirection:rtl?'row-reverse':'row'}]}><View style={{flex:1}}>{txt(item.kind,{fontWeight:'800',fontSize:13})}{txt(item.reference||new Date(item.createdAt).toLocaleDateString(),{fontSize:10,color:C.muted})}</View><Text style={{fontWeight:'900',color:item.points>=0?C.teal:C.ink}}>{item.points>0?'+':''}{item.points} POINTS</Text></View>):<Text style={S.empty}>{w.none}</Text>}</View></ScrollView>);

  if(page==='business')return shell(<ScrollView contentContainerStyle={S.page}>{header(w.business)}{merchants.length>0&&<View style={S.card}>{txt(w.business,{fontSize:14,fontWeight:'900',marginBottom:8})}<View style={[S.row,{flexWrap:'wrap'}]}>{merchants.map(m=><Pressable key={m.id} accessibilityRole="button" accessibilityState={{selected:activeMerchant?.merchantId===m.id}} onPress={()=>void loadMerchant(m.id)} style={{padding:10,borderRadius:12,backgroundColor:activeMerchant?.merchantId===m.id?C.teal:C.pale,margin:3}}><Text style={{fontSize:11,fontWeight:'900',color:activeMerchant?.merchantId===m.id?C.white:C.teal}}>{m.display_name}</Text></Pressable>)}</View></View>}{!activeMerchant?<View style={S.formCard}>{txt(w.createBusiness,{fontSize:18,fontWeight:'900',marginBottom:12})}{label(w.legalName)}{field(merchantLegalName,setMerchantLegalName,'Bekheet Trading LLC')}{label(w.displayName)}{field(merchantDisplayName,setMerchantDisplayName,'My business')}{txt(countryCode+' · '+(MARKETS.find(m=>m.code===countryCode)?.currency||currency),{fontSize:12,color:C.muted,marginVertical:8})}{button(w.createBusiness,createMerchant)}<Text style={S.notice}>{w.businessNote}</Text></View>:<><View style={S.card}>{txt(activeMerchant.displayName,{fontSize:20,fontWeight:'900'})}{txt(activeMerchant.legalName,{fontSize:12,color:C.muted,marginTop:4})}{detailLine(w.kyb,activeMerchant.kybStatus)}{detailLine(w.settlement,activeMerchant.accounts[0]?.settlementStatus||'blocked')}{detailLine(w.currency,activeMerchant.currency)}{detailLine(w.business,activeMerchant.status)}<View style={S.sectionHeading}>{txt(w.wallet,{fontSize:14,fontWeight:'900'})}</View>{activeMerchant.accounts.map(a=><View key={a.currency} style={[S.txrow,{flexDirection:rtl?'row-reverse':'row'}]}><Text style={{flex:1,fontWeight:'800'}}>{a.currency}</Text><Text style={{fontWeight:'900'}}>{money(a.balance)} {a.currency}</Text></View>)}{button(w.createMerchantAccount,createMerchantAccount,true)}</View>{activeMerchant.kybStatus!=='approved'?<View style={S.formCard}>{txt(w.submitKyb,{fontSize:16,fontWeight:'900',marginBottom:8})}{label(w.registrationNumber)}{field(registrationNumber,setRegistrationNumber,'REG-123456')}{button(w.submitKyb,submitKyb)}<Text style={S.notice}>{w.businessNote}</Text></View>:<><View style={S.formCard}>{txt(w.createMerchantLink,{fontSize:16,fontWeight:'900',marginBottom:8})}{label(w.amount)}{field(merchantLinkAmount,setMerchantLinkAmount,'0.00','decimal-pad')}{button(w.createMerchantLink,createMerchantPaymentLink)}{merchantLinkCode?button(w.copy,()=>void Clipboard.setStringAsync(merchantLinkCode).then(()=>Alert.alert(w.copied)),true):null}</View><View style={S.formCard}>{txt(w.createOffer,{fontSize:16,fontWeight:'900',marginBottom:8})}{field(merchantOfferName,setMerchantOfferName,w.offerName)}{button(w.createOffer,createMerchantOffer)}</View><View style={S.formCard}>{txt(w.createCampaign,{fontSize:16,fontWeight:'900',marginBottom:8})}{field(merchantCampaignName,setMerchantCampaignName,w.campaignName)}{field(merchantCampaignBudget,setMerchantCampaignBudget,w.campaignBudget,'numeric')}{button(w.createCampaign,createMerchantCampaign)}</View></> }<View style={S.card}>{txt(w.offerName,{fontSize:14,fontWeight:'900'})}{merchantOffers.length?merchantOffers.map(o=><View key={o.id} style={S.txrow}>{txt(o.name,{fontWeight:'800'})}{txt(o.status,{fontSize:10,color:C.muted})}</View>):<Text style={S.empty}>{w.none}</Text>}{txt(w.campaignName,{fontSize:14,fontWeight:'900',marginTop:12})}{merchantCampaigns.length?merchantCampaigns.map(o=><View key={o.id} style={S.txrow}>{txt(o.name,{fontWeight:'800'})}{txt(o.status,{fontSize:10,color:C.muted})}</View>):<Text style={S.empty}>{w.none}</Text>}</View></>}<Text style={S.notice}>{w.businessNote}</Text></ScrollView>);

  if(page==='send')return shell(<ScrollView contentContainerStyle={S.page}>{header(w.send)}<View style={S.formCard}>{txt(w.recipient,{fontSize:13,fontWeight:'900',marginBottom:8})}{<View style={[S.row,{flexWrap:'wrap',marginBottom:10}]}>{MARKETS.map(m=><Pressable key={m.code} accessibilityRole="button" accessibilityState={{selected:recipientCountryCode===m.code}} onPress={()=>setRecipientCountryCode(m.code)} style={{paddingHorizontal:10,paddingVertical:7,borderRadius:11,backgroundColor:recipientCountryCode===m.code?C.teal:C.pale}}><Text style={{fontSize:10,fontWeight:'900',color:recipientCountryCode===m.code?C.white:C.teal}}>{m.code}</Text></Pressable>)}</View>}{field(to,setTo,'010 0000 0000','phone-pad')}{txt(w.amount,{fontSize:13,fontWeight:'900',marginBottom:8})}{field(amount,setAmount,'0.00','decimal-pad')}{parseMoney(amount)?<View style={S.amountPreview}><Text style={S.amountPreviewValue}>{money(parseMoney(amount)!)} <Text style={S.metricCurrency}>{currency}</Text></Text></View>:null}{txt(w.note,{fontSize:13,fontWeight:'900',marginBottom:8})}{field(note,setNote,w.note)}<View style={S.inlineInfo}><Text style={S.inlineInfoIcon}>✓</Text>{txt(w.free,{fontSize:12,color:C.muted})}</View>{button(w.send,doSend)}</View></ScrollView>);
  if(page==='link')return shell(<ScrollView contentContainerStyle={S.page}>{header(w.link)}{!linkCode?<View style={S.formCard}>{txt(w.amount,{fontSize:13,fontWeight:'900',marginBottom:8})}{field(linkAmount,setLinkAmount,'0.00','decimal-pad')}{parseMoney(linkAmount)?<View style={S.amountPreview}><Text style={S.amountPreviewValue}>{money(parseMoney(linkAmount)!)} <Text style={S.metricCurrency}>{currency}</Text></Text></View>:null}{txt(w.desc,{fontSize:13,fontWeight:'900',marginBottom:8})}{field(description,setDescription,w.desc)}{button(w.create,doLink)}<Text style={S.notice}>{w.linkNote}</Text></View>:<View style={S.card}>{txt(w.ready,{fontSize:20,fontWeight:'900',textAlign:'center'})}<Text style={S.code}>{linkCode}</Text>{button(w.copy,()=>void Clipboard.setStringAsync(linkCode).then(()=>Alert.alert(w.copied)))}{button(w.share,()=>void Share.share({message:w.ready+': '+linkCode}),true)}<Text style={S.notice}>{w.linkNote}</Text></View>}</ScrollView>);
  if(page==='transaction'&&selectedTx)return shell(<ScrollView contentContainerStyle={S.page}>{header(w.transactionDetails)}<View style={S.detailHero}><View style={S.detailIcon}><Text style={{fontSize:25,color:C.teal,fontWeight:'900'}}>{selectedTx.amount>=0?'+':'−'}</Text></View><Text style={[S.bigAmount,{marginBottom:5,color:selectedTx.amount>=0?C.teal:C.ink}]}>{selectedTx.amount>0?'+':''}{money(selectedTx.amount)} <Text style={S.metricCurrency}>{selectedTx.currency||currency}</Text></Text>{txt(selectedTx.kind==='topup'?w.kTopup:selectedTx.kind==='link_payment'?w.kLink:selectedTx.amount>=0?w.kReceive:w.kSend,{fontSize:13,color:C.muted,fontWeight:'800'})}</View><View style={S.card}>{detailLine(w.transactionType,selectedTx.kind)}{detailLine(w.transactionDate,new Date(selectedTx.createdAt).toLocaleString(lang==='ar'?'ar-EG':'en-GB'))}{detailLine(w.transactionId,selectedTx.id)}{detailLine(w.transactionNote,selectedTx.memo||w.noNote)}</View>{button(w.copyReceipt,()=>void Clipboard.setStringAsync([w.transactionDetails,selectedTx.id,w.recordedAmount+': '+money(selectedTx.amount)+' '+(selectedTx.currency||currency),new Date(selectedTx.createdAt).toISOString(),selectedTx.memo||''].join('\n')).then(()=>Alert.alert(w.copied)),true)}{button(w.share,()=>void Share.share({message:[w.transactionDetails,selectedTx.id,w.recordedAmount+': '+money(selectedTx.amount)+' '+(selectedTx.currency||currency),new Date(selectedTx.createdAt).toLocaleString(),selectedTx.memo||''].join('\n')}),true)}</ScrollView>);
  if(page==='receipt'&&receipt)return shell(<View style={S.page}><View style={S.success}><Text style={{fontSize:32}}>✓</Text></View>{txt(w.sent,{fontSize:23,fontWeight:'900',textAlign:'center'})}<Text style={S.bigAmount}>{money(receipt.amount)} {receipt.currency}</Text><View style={S.card}>{detailLine(w.to,receipt.to)}{detailLine(w.fee,w.free)}{detailLine(w.transactionDate,new Date(receipt.at).toLocaleString(lang==='ar'?'ar-EG':'en-GB'))}</View>{button(w.receiptCopy,()=>void Clipboard.setStringAsync([w.sent,w.recordedAmount+': '+money(receipt.amount)+' '+receipt.currency,w.to+': '+receipt.to,w.transactionDate+': '+new Date(receipt.at).toISOString()].join('\n')).then(()=>Alert.alert(w.copied)),true)}{button(w.share,()=>void Share.share({message:[w.sent,w.recordedAmount+': '+money(receipt.amount)+' '+receipt.currency,w.to+': '+receipt.to,w.transactionDate+': '+new Date(receipt.at).toLocaleString()].join('\n')}),true)}<View style={{flex:1}}/>{button(w.back,()=>{setPage('tabs');setTab('home');})}</View>);
  return shell(<View style={{flex:1}}>
    {tab==='home'&&<ScrollView contentContainerStyle={S.page} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={()=>void refresh()}/>}><View style={[S.row,{justifyContent:'space-between'}]}><Text style={S.brandSmall}>{w.app}</Text><Pressable accessibilityRole="button" accessibilityLabel={w.account} onPress={()=>setTab('account')} style={S.avatar}><Text style={{color:C.teal,fontWeight:'900'}}>{phone.slice(-1)}</Text></Pressable></View><View style={S.balance}><View style={S.balanceHeader}>{txt(w.balance,{color:'#D7E8E4'})}<Pressable accessibilityRole="button" accessibilityLabel={balanceVisible?'Hide balance':'Show balance'} onPress={()=>setBalanceVisible(v=>!v)} style={S.balanceEye}><Text style={S.balanceEyeText}>{balanceVisible?'◉':'◎'}</Text></Pressable></View><View style={{flexDirection:rtl?'row-reverse':'row',flexWrap:'wrap',gap:7,marginTop:12,marginBottom:10}}>{['EGP','AED','SAR','GBP','USD'].map(code=><Pressable key={code} accessibilityRole="button" accessibilityLabel={code+' wallet'} onPress={()=>void createCurrencyWallet(code)} style={{paddingHorizontal:12,paddingVertical:7,borderRadius:18,backgroundColor:currency===code?C.lime:'rgba(255,255,255,0.14)',borderWidth:1,borderColor:currency===code?C.lime:'rgba(255,255,255,0.25)'}}><Text style={{fontSize:11,fontWeight:'900',color:currency===code?C.ink:'#FFFFFF'}}>{code}{wallets.some(x=>x.currency===code)?'':' +'}</Text></Pressable>)}</View><Text style={S.balanceValue}>{balanceVisible?money(balance):'••••••'} <Text style={{fontSize:14}}>{currency}</Text></Text>{currency==='EGP'?button(w.add,()=>setTopup(true)):txt(w.prototype,{color:'#D7E8E4',fontSize:11})}</View><View style={[S.row,{justifyContent:'space-between',marginVertical:20}]}>{[[w.send,'↗',()=>{setAmount('');setPage('send');}],[w.request,'↙',()=>Alert.alert(w.soon)],[w.link,'⌁',()=>{setLinkCode('');setPage('link');}],[w.split,'⊞',()=>Alert.alert(w.soon)]].map(([s,ic,fn]:any)=><Pressable key={s} accessibilityRole="button" accessibilityLabel={s} onPress={fn} style={S.action}><View style={S.actionIcon}><Text style={{fontSize:22,color:C.teal}}>{ic}</Text></View><Text style={{fontSize:11,fontWeight:'800',color:C.ink}}>{s}</Text></Pressable>)}</View><View style={S.sectionHeading}>{txt(w.thisMonth,{fontSize:18,fontWeight:'900'})}{txt(new Date().toLocaleDateString(lang==='ar'?'ar-EG':'en-GB',{month:'long',year:'numeric'}),{fontSize:11,color:C.muted})}</View><View style={S.monthCard}><View style={[S.monthMetricRow,{flexDirection:rtl?'row-reverse':'row'}]}><View style={S.monthMetric}><View style={[S.metricDot,{backgroundColor:'#79B9A2'}]}/>{txt(w.moneyIn,{fontSize:12,color:C.muted})}<Text style={S.metricValue}>{money(monthIn)} <Text style={S.metricCurrency}>{currency}</Text></Text></View><View style={S.metricDivider}/><View style={S.monthMetric}><View style={[S.metricDot,{backgroundColor:'#E8B477'}]}/>{txt(w.moneyOut,{fontSize:12,color:C.muted})}<Text style={S.metricValue}>{money(monthOut)} <Text style={S.metricCurrency}>{currency}</Text></Text></View></View><View style={[S.flowTrack,{flexDirection:rtl?'row-reverse':'row'}]}><View style={[S.flowIn,{flex:monthIn||monthOut?Math.max(monthIn,1):1}]}/><View style={[S.flowOut,{flex:monthIn||monthOut?Math.max(monthOut,1):1}]}/></View></View><View style={S.sectionHeading}>{txt(w.recent,{fontSize:18,fontWeight:'900'})}<Pressable accessibilityRole="button" onPress={()=>setTab('activity')}><Text style={S.viewAll}>{rtl?'عرض الكل':'View all'} ›</Text></Pressable></View><View style={S.card}>{tx.length?tx.slice(0,5).map(row):<Text style={S.empty}>{w.none}</Text>}</View><View style={[S.card,{marginTop:14}]}>{txt(w.rewards,{fontSize:16,fontWeight:'900'})}<View style={[S.row,{justifyContent:'space-between',alignItems:'center',marginTop:8}]}><Text style={{fontSize:24,fontWeight:'900',color:C.teal}}>{rewards?.pointsBalance?.toLocaleString('en-US')||'0'} POINTS</Text>{button(w.view,()=>setPage('rewards'),true)}</View></View><Text style={S.notice}>{w.prototype}</Text></ScrollView>}
    {tab==='activity'&&<ScrollView contentContainerStyle={S.page} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={()=>void refresh()} />}>{txt(w.activity,{fontSize:22,fontWeight:'900',marginBottom:16})}{field(activitySearch,setActivitySearch,w.searchTransactions)}<View style={[S.filterRow,{flexDirection:rtl?'row-reverse':'row'}]}>{([{key:'all',label:w.all},{key:'in',label:w.incoming},{key:'out',label:w.outgoing}] as const).map(f=><Pressable key={f.key} accessibilityRole="button" accessibilityState={{selected:activityFilter===f.key}} onPress={()=>setActivityFilter(f.key)} style={[S.filterChip,activityFilter===f.key&&S.filterChipActive]}><Text style={[S.filterText,activityFilter===f.key&&S.filterTextActive]}>{f.label}</Text></Pressable>)}</View><View style={S.card}>{activityTx.length?activityTx.map(row):<Text style={S.empty}>{w.none}</Text>}</View></ScrollView>}
    {tab==='account'&&<ScrollView contentContainerStyle={S.page}>{txt(w.account,{fontSize:22,fontWeight:'900',marginBottom:16})}<View style={[S.profileCard,{flexDirection:rtl?'row-reverse':'row'}]}><View style={S.profileAvatar}><Text style={S.profileInitial}>{phone.slice(-1)||'F'}</Text></View><View style={{flex:1}}>{txt(w.profile,{fontSize:11,color:C.muted,fontWeight:'800'})}{txt(phone,{fontSize:17,fontWeight:'900',marginTop:4})}</View><View style={S.profileMark}><Text style={{color:C.teal,fontWeight:'900'}}>✓</Text></View></View><View style={S.card}>{button(w.business,openBusiness,true)}{button(w.rewards,()=>setPage('rewards'),true)}</View><View style={S.card}><View style={[S.sectionHeading,{marginTop:0}]}>{txt(w.language,{fontSize:15,fontWeight:'900'})}</View><View style={S.row}><Pressable accessibilityRole="button" accessibilityState={{selected:rtl}} onPress={()=>void setLanguage('ar')} style={[S.langOption,rtl&&S.langSelected]}><Text style={{color:rtl?C.white:C.ink,fontWeight:'800'}}>العربية</Text></Pressable><Pressable accessibilityRole="button" accessibilityState={{selected:!rtl}} onPress={()=>void setLanguage('en')} style={[S.langOption,!rtl&&S.langSelected]}><Text style={{color:!rtl?C.white:C.ink,fontWeight:'800'}}>English</Text></Pressable></View></View><View style={[S.card,{marginTop:14}]}>{txt(w.security,{fontSize:15,fontWeight:'900',marginBottom:4})}{txt(w.sessionHelp,{fontSize:12,color:C.muted,marginBottom:8})}<View style={[S.sectionHeading,{marginTop:8}]}>{txt(w.activeSessions,{fontSize:13,fontWeight:'900'})}<Text style={S.sessionCount}>{sessions.length}</Text></View>{sessions.length?sessions.map(s=><View key={s.id} style={[S.txrow,{flexDirection:rtl?'row-reverse':'row'}]}><View style={{flex:1}}>{txt(s.is_current?w.currentDevice:w.otherDevice,{fontWeight:'800',fontSize:13})}{txt(new Date(s.created_at).toLocaleString(lang==='ar'?'ar-EG':'en-GB'),{fontSize:10,color:C.muted})}</View><Pressable accessibilityRole="button" accessibilityLabel={w.revoke} disabled={busy||s.is_current} onPress={()=>Alert.alert(w.revoke,'',[{text:w.cancel,style:'cancel'},{text:w.revoke,style:'destructive',onPress:()=>void revokeSession(s.id)}])} style={[S.revokeButton,s.is_current&&{opacity:.35}]}><Text style={{color:C.red,fontWeight:'800',fontSize:11}}>{s.is_current?(rtl?'الحالية':'Current'):w.revoke}</Text></Pressable></View>):<Text style={S.empty}>{w.none}</Text>}<Text style={S.securityFoot}>{w.signOutHelp}</Text>{button(w.logoutAll,()=>Alert.alert(w.logoutAll,'',[{text:w.cancel,style:'cancel'},{text:w.logoutAll,style:'destructive',onPress:()=>void logoutAll()}]),true)}{button(w.logout,()=>Alert.alert(w.logout,'',[{text:w.cancel,style:'cancel'},{text:w.logout,style:'destructive',onPress:()=>void logout()}]),true)}</View><Text style={S.notice}>{w.prototype}</Text>{txt(w.appVersion,{fontSize:10,color:C.muted,textAlign:'center',marginTop:14})}</ScrollView>}
    <View style={[S.nav,{flexDirection:rtl?'row-reverse':'row'}]}>{[[w.home,'⌂','home'],[w.activity,'▤','activity'],[w.account,'◯','account']].map(([s,ic,k]:any)=><Pressable key={k} accessibilityRole="button" accessibilityLabel={s} accessibilityState={{selected:tab===k}} onPress={()=>setTab(k)} style={S.navItem}><Text style={{fontSize:20,color:tab===k?C.teal:C.muted}}>{ic}</Text><Text style={{fontSize:10,color:tab===k?C.teal:C.muted,fontWeight:'800'}}>{s}</Text></Pressable>)}</View>
    {topup&&<View style={S.modal}><View style={S.modalCard}><View style={[S.row,{justifyContent:'space-between'}]}><Text style={S.title}>{w.topup}</Text><Pressable onPress={()=>setTopup(false)}><Text style={{fontSize:26}}>×</Text></Pressable></View>{label(w.amount)}{field(amount,setAmount,'0.00','decimal-pad')}<View style={S.row}>{(['instapay','card','wallet'] as const).map(m=><Pressable key={m} onPress={()=>setMethod(m)} style={[S.method,method===m&&S.methodActive]}><Text style={{fontSize:11,color:method===m?C.teal:C.muted,fontWeight:'800'}}>{w[m]}</Text></Pressable>)}</View><Text style={S.notice}>{w.mock}</Text>{button(w.add,doTopup)}</View></View>}
  </View>);
}
const S=StyleSheet.create({
 shell:{flex:1,backgroundColor:C.bg},
 login:{flexGrow:1,paddingHorizontal:24,paddingTop:30,paddingBottom:34,justifyContent:'center'},
 loginIntro:{alignItems:'flex-start'},
 loginForm:{backgroundColor:C.white,borderRadius:24,padding:20,borderWidth:1,borderColor:C.line,shadowColor:'#173B32',shadowOpacity:.06,shadowRadius:18,shadowOffset:{width:0,height:8},elevation:3},
 page:{padding:20,paddingBottom:32},
 formCard:{backgroundColor:C.white,borderRadius:22,borderWidth:1,borderColor:C.line,padding:18,shadowColor:'#173B32',shadowOpacity:.04,shadowRadius:14,shadowOffset:{width:0,height:6},elevation:2},amountPreview:{backgroundColor:C.pale,borderRadius:15,padding:13,marginTop:-5,marginBottom:15,alignItems:'flex-start'},amountPreviewValue:{fontSize:22,fontWeight:'900',color:C.teal},inlineInfo:{flexDirection:'row',alignItems:'center',gap:8,backgroundColor:C.pale,borderRadius:13,padding:12,marginTop:3},inlineInfoIcon:{color:C.teal,fontWeight:'900',fontSize:15},
 sectionHeading:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',marginTop:23,marginBottom:11},viewAll:{color:C.teal,fontWeight:'900',fontSize:12},
 monthCard:{backgroundColor:C.white,borderRadius:20,borderWidth:1,borderColor:C.line,padding:16},monthMetricRow:{alignItems:'center',gap:12},monthMetric:{flex:1,gap:6},metricDot:{width:8,height:8,borderRadius:4},metricValue:{fontSize:20,fontWeight:'900',color:C.ink,letterSpacing:-.4},metricCurrency:{fontSize:10,color:C.muted,fontWeight:'700'},metricDivider:{width:1,height:54,backgroundColor:C.line},flowTrack:{height:8,borderRadius:5,overflow:'hidden',gap:3,marginTop:16},flowIn:{backgroundColor:'#79B9A2',borderRadius:5},flowOut:{backgroundColor:'#E8B477',borderRadius:5},
 filterRow:{gap:8,marginBottom:14},filterChip:{minHeight:40,paddingHorizontal:17,borderRadius:14,backgroundColor:C.white,borderWidth:1,borderColor:C.line,justifyContent:'center'},filterChipActive:{backgroundColor:C.teal,borderColor:C.teal},filterText:{fontSize:12,fontWeight:'800',color:C.muted},filterTextActive:{color:C.white},
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
 detailHero:{alignItems:'center',backgroundColor:C.white,borderRadius:22,borderWidth:1,borderColor:C.line,padding:22,marginBottom:16},detailIcon:{width:58,height:58,borderRadius:20,backgroundColor:C.pale,alignItems:'center',justifyContent:'center',marginBottom:16},detailLine:{alignItems:'flex-start',justifyContent:'space-between',gap:12,paddingVertical:14,borderBottomWidth:StyleSheet.hairlineWidth,borderColor:C.line},detailKey:{color:C.muted,fontSize:12,fontWeight:'700',flex:1},detailValue:{color:C.ink,fontSize:12,fontWeight:'800',flex:2,textAlign:'right'},
 success:{width:68,height:68,borderRadius:34,backgroundColor:C.lime,alignItems:'center',justifyContent:'center',alignSelf:'center',marginTop:55,marginBottom:16},
 bigAmount:{fontSize:34,fontWeight:'900',textAlign:'center',marginBottom:24},
 langOption:{flex:1,minHeight:44,alignItems:'center',justifyContent:'center',borderRadius:12,backgroundColor:C.bg},
 langSelected:{backgroundColor:C.teal},
 method:{flex:1,minHeight:48,borderRadius:13,borderWidth:1,borderColor:C.line,alignItems:'center',justifyContent:'center'},
 methodActive:{borderColor:C.teal,backgroundColor:C.pale},
 profileCard:{backgroundColor:C.white,borderRadius:20,borderWidth:1,borderColor:C.line,padding:17,alignItems:'center',gap:13,marginBottom:14},profileAvatar:{width:52,height:52,borderRadius:18,backgroundColor:C.pale,alignItems:'center',justifyContent:'center'},profileInitial:{fontSize:22,fontWeight:'900',color:C.teal},profileMark:{width:25,height:25,borderRadius:13,backgroundColor:C.lime,alignItems:'center',justifyContent:'center'},sessionCount:{backgroundColor:C.pale,color:C.teal,fontSize:11,fontWeight:'900',overflow:'hidden',paddingHorizontal:9,paddingVertical:4,borderRadius:9},revokeButton:{paddingHorizontal:10,paddingVertical:9,borderRadius:10,backgroundColor:'#FDF1F0'},securityFoot:{fontSize:11,color:C.muted,lineHeight:17,marginTop:10},
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
