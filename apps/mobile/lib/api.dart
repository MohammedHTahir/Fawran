import 'dart:convert';
import 'package:http/http.dart' as http;

class ApiException implements Exception {
  ApiException(this.status, this.message);
  final int status; // 0 = network problem
  final String message;
  @override
  String toString() => message;
}

class Txn {
  Txn({required this.id, required this.kind, required this.amount, required this.createdAt, this.memo});
  final String id;
  final String kind; // topup | p2p | link_payment
  final int amount; // signed piasters from this account's point of view
  final DateTime createdAt;
  final String? memo;

  factory Txn.fromJson(Map<String, dynamic> j) => Txn(
        id: j['id'] as String,
        kind: j['kind'] as String,
        amount: (j['amount'] as num).toInt(),
        createdAt: DateTime.parse(j['createdAt'] as String).toLocal(),
        memo: j['memo'] as String?,
      );
}

class ApiClient {
  ApiClient({String? baseUrl, http.Client? client})
      : baseUrl = baseUrl ?? const String.fromEnvironment('API_URL', defaultValue: 'http://10.0.2.2:3000'),
        _http = client ?? http.Client();

  final String baseUrl;
  final http.Client _http;
  String? token;

  Future<dynamic> _send(String method, String path, {Map<String, dynamic>? body, String? idemKey}) async {
    final uri = Uri.parse('$baseUrl$path');
    final headers = <String, String>{
      'Content-Type': 'application/json',
      if (token != null) 'Authorization': 'Bearer $token',
      if (idemKey != null) 'Idempotency-Key': idemKey,
    };
    http.Response r;
    try {
      r = method == 'GET'
          ? await _http.get(uri, headers: headers).timeout(const Duration(seconds: 15))
          : await _http.post(uri, headers: headers, body: jsonEncode(body ?? {})).timeout(const Duration(seconds: 15));
    } on Exception {
      throw ApiException(0, 'network');
    }
    dynamic decoded;
    if (r.body.isNotEmpty) {
      try {
        decoded = jsonDecode(r.body);
      } on FormatException {
        decoded = null;
      }
    }
    if (r.statusCode >= 200 && r.statusCode < 300) return decoded;
    var msg = 'error';
    if (decoded is Map && decoded['message'] != null) {
      final m = decoded['message'];
      msg = m is List ? m.join(', ') : m.toString();
    }
    throw ApiException(r.statusCode, msg);
  }

  Future<void> requestOtp(String phone) => _send('POST', '/auth/otp', body: {'phone': phone});

  Future<String> verify(String phone, String code) async {
    final r = await _send('POST', '/auth/verify', body: {'phone': phone, 'code': code});
    return (r as Map)['token'] as String;
  }

  Future<int> wallet() async => ((await _send('GET', '/wallet')) as Map)['balance'] as int;

  Future<List<Txn>> transactions() async {
    final r = await _send('GET', '/transactions') as List;
    return r.map((e) => Txn.fromJson(e as Map<String, dynamic>)).toList();
  }

  Future<int> topup(int amount, String method, String key) async {
    final r = await _send('POST', '/wallet/topup', body: {'amount': amount, 'method': method}, idemKey: key);
    return (r as Map)['balance'] as int;
  }

  Future<int> transfer(String toPhone, int amount, String? note, String key) async {
    final r = await _send('POST', '/transfers',
        body: {'toPhone': toPhone, 'amount': amount, if (note != null && note.isNotEmpty) 'note': note}, idemKey: key);
    return (r as Map)['balance'] as int;
  }

  Future<String> createLink(int amount, String? description) async {
    final r = await _send('POST', '/links',
        body: {'amount': amount, if (description != null && description.isNotEmpty) 'description': description});
    return (r as Map)['code'] as String;
  }
}
