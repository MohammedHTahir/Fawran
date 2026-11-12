import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import '../api.dart';
import '../money.dart';
import '../state.dart';
import '../theme.dart';
import '../widgets.dart';

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});
  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _phone = TextEditingController();
  final _code = TextEditingController();
  bool _codeSent = false;
  bool _busy = false;

  @override
  void dispose() {
    _phone.dispose();
    _code.dispose();
    super.dispose();
  }

  Future<void> _go() async {
    final s = AppScope.of(context);
    if (!isEgyptianMobile(_phone.text)) {
      toast(context, s.t('errInvalidPhone'));
      return;
    }
    setState(() => _busy = true);
    try {
      if (!_codeSent) {
        await s.requestOtp(_phone.text.trim());
        if (mounted) setState(() => _codeSent = true);
      } else {
        await s.verify(_phone.text.trim(), _code.text.trim());
      }
    } on ApiException catch (e) {
      if (mounted) toast(context, e.status == 401 && _codeSent ? s.t('errWrongCode') : s.errorText(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final s = AppScope.of(context);
    return Scaffold(
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(24),
          children: [
            Align(
              alignment: AlignmentDirectional.centerEnd,
              child: TextButton(
                onPressed: () => s.setLang(s.lang == 'ar' ? 'en' : 'ar'),
                child: Text(s.lang == 'ar' ? 'English' : 'العربية'),
              ),
            ),
            const SizedBox(height: 40),
            Text(s.t('appName'), style: const TextStyle(fontSize: 40, fontWeight: FontWeight.w800, color: teal)),
            const SizedBox(height: 8),
            Text(s.t('welcome'), style: const TextStyle(fontSize: 18, color: muted)),
            const SizedBox(height: 40),
            TextField(
              controller: _phone,
              enabled: !_codeSent,
              keyboardType: TextInputType.phone,
              textDirection: TextDirection.ltr,
              decoration: InputDecoration(labelText: s.t('phoneLabel'), hintText: '010 0000 0000'),
            ),
            if (_codeSent) ...[
              const SizedBox(height: 16),
              TextField(
                controller: _code,
                keyboardType: TextInputType.number,
                textDirection: TextDirection.ltr,
                maxLength: 6,
                decoration: InputDecoration(labelText: s.t('codeLabel')),
              ),
              if (kDebugMode) Text(s.t('devHint'), style: const TextStyle(color: muted)),
            ],
            const SizedBox(height: 24),
            FilledButton(
              onPressed: _busy ? null : _go,
              child: _busy
                  ? const SizedBox(height: 22, width: 22, child: CircularProgressIndicator(strokeWidth: 2))
                  : Text(_codeSent ? s.t('verify') : s.t('sendCode')),
            ),
            const SizedBox(height: 24),
            Center(child: Text(s.t('prototypeNote'), style: const TextStyle(color: muted, fontSize: 13))),
          ],
        ),
      ),
    );
  }
}
