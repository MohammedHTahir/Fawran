import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../api.dart';
import '../money.dart';
import '../state.dart';
import '../theme.dart';
import '../widgets.dart';

/// Base address of the public payer page (not built yet). Set with --dart-define=PAY_URL=...
const payBaseUrl = String.fromEnvironment('PAY_URL', defaultValue: 'https://YOUR-DOMAIN/p');

class LinkScreen extends StatefulWidget {
  const LinkScreen({super.key});
  @override
  State<LinkScreen> createState() => _LinkScreenState();
}

class _LinkScreenState extends State<LinkScreen> {
  final _amount = TextEditingController();
  final _desc = TextEditingController();
  bool _busy = false;
  String? _code;

  @override
  void dispose() {
    _amount.dispose();
    _desc.dispose();
    super.dispose();
  }

  Future<void> _create() async {
    final s = AppScope.of(context);
    final amount = parseEgp(_amount.text);
    if (amount == null || amount < 100) {
      toast(context, s.t('errInvalidAmount'));
      return;
    }
    setState(() => _busy = true);
    try {
      final code = await s.api.createLink(amount, _desc.text.trim());
      if (mounted) setState(() => _code = code);
    } on ApiException catch (e) {
      if (mounted) toast(context, s.errorText(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final s = AppScope.of(context);
    final url = _code == null ? '' : '$payBaseUrl/$_code';
    return Scaffold(
      appBar: AppBar(title: Text(s.t('linkCreate'))),
      body: ListView(
        padding: const EdgeInsets.all(20),
        children: [
          TextField(
            controller: _amount,
            keyboardType: const TextInputType.numberWithOptions(decimal: true),
            textDirection: TextDirection.ltr,
            decoration: InputDecoration(labelText: s.t('amountLabel')),
          ),
          const SizedBox(height: 16),
          TextField(controller: _desc, decoration: InputDecoration(labelText: s.t('linkDesc'))),
          const SizedBox(height: 24),
          FilledButton(onPressed: _busy ? null : _create, child: Text(s.t('create'))),
          if (_code != null) ...[
            const SizedBox(height: 24),
            Container(
              padding: const EdgeInsets.all(20),
              decoration: BoxDecoration(color: teal, borderRadius: BorderRadius.circular(22)),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(s.t('linkReady'), style: const TextStyle(color: Colors.white)),
                  const SizedBox(height: 8),
                  SelectableText(url,
                      textDirection: TextDirection.ltr,
                      style: const TextStyle(color: Colors.white, fontSize: 17, fontWeight: FontWeight.w600)),
                  const SizedBox(height: 12),
                  FilledButton(
                    style: FilledButton.styleFrom(backgroundColor: lime, foregroundColor: ink, minimumSize: const Size(0, 44)),
                    onPressed: () async {
                      await Clipboard.setData(ClipboardData(text: url));
                      if (context.mounted) toast(context, s.t('copied'));
                    },
                    child: Text(s.t('copy')),
                  ),
                ],
              ),
            ),
          ],
        ],
      ),
    );
  }
}
