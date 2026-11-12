import 'dart:math';
import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'api.dart';
import 'strings.dart';

String newKey() => '${DateTime.now().microsecondsSinceEpoch}-${Random.secure().nextInt(1 << 31)}';

class AppState extends ChangeNotifier {
  AppState(this.api, {FlutterSecureStorage? storage}) : _storage = storage ?? const FlutterSecureStorage();

  final ApiClient api;
  final FlutterSecureStorage _storage;
  String lang = 'ar';
  String? phone;
  int balance = 0;
  List<Txn> txns = [];

  bool get loggedIn => api.token != null;
  String t(String k) => tr(lang, k);

  Future<void> init() async {
    lang = await _storage.read(key: 'lang') ?? 'ar';
    api.token = await _storage.read(key: 'token');
    phone = await _storage.read(key: 'phone');
  }

  Future<void> setLang(String l) async {
    lang = l;
    await _storage.write(key: 'lang', value: l);
    notifyListeners();
  }

  Future<void> requestOtp(String p) => api.requestOtp(p);

  Future<void> verify(String p, String code) async {
    api.token = await api.verify(p, code);
    phone = p;
    await _storage.write(key: 'token', value: api.token);
    await _storage.write(key: 'phone', value: p);
    notifyListeners();
    await refresh();
  }

  Future<void> logout() async {
    api.token = null;
    balance = 0;
    txns = [];
    await _storage.delete(key: 'token');
    notifyListeners();
  }

  Future<void> refresh() async {
    try {
      balance = await api.wallet();
      txns = await api.transactions();
    } on ApiException catch (e) {
      if (e.status == 401) {
        await logout();
        return;
      }
    }
    notifyListeners();
  }

  Future<void> topup(int amount, String method, String key) async {
    balance = await api.topup(amount, method, key);
    notifyListeners();
    await refresh();
  }

  Future<void> send(String toPhone, int amount, String? note, String key) async {
    balance = await api.transfer(toPhone, amount, note, key);
    notifyListeners();
    await refresh();
  }

  String errorText(Object e) {
    if (e is! ApiException) return t('errGeneric');
    switch (e.status) {
      case 0:
        return t('errNetwork');
      case 401:
        return t('errSession');
      case 404:
        return t('errRecipient');
      case 422:
        return t('errFunds');
      case 400:
        return t('errInvalid');
      default:
        return t('errGeneric');
    }
  }

  String kindLabel(Txn x) {
    switch (x.kind) {
      case 'topup':
        return t('kTopup');
      case 'link_payment':
        return t('kLink');
      default:
        return x.amount >= 0 ? t('kReceive') : t('kSend');
    }
  }
}

class AppScope extends InheritedNotifier<AppState> {
  const AppScope({super.key, required AppState state, required super.child}) : super(notifier: state);
  static AppState of(BuildContext c) => c.dependOnInheritedWidgetOfExactType<AppScope>()!.notifier!;
}
