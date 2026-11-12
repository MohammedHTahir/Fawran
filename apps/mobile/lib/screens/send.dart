import 'package:flutter/material.dart';
import '../api.dart';
import '../money.dart';
import '../state.dart';
import '../theme.dart';
import '../widgets.dart';

class SendScreen extends StatefulWidget {
  const SendScreen({super.key});
  @override
  State<SendScreen> createState() => _SendScreenState();
}

class _SendScreenState extends State<SendScreen> {
  final _phone = TextEditingController();
  final _amount = TextEditingController();
  final _note = TextEditingController();
  bool _busy = false;
  String _fp = '';
  String _key = newKey();

  @override
  void dispose() {
    _phone.dispose();
    _amount.dispose();
    _note.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final s = AppScope.of(context);
    final amount = parseEgp(_amount.text);
    if (!isEgyptianMobile(_phone.text)) {
      toast(context, s.t('errInvalidPhone'));
      return;
    }
    if (amount == null) {
      toast(context, s.t('errInvalidAmount'));
      return;
    }
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(s.t('confirmTitle')),
        content: Text('${formatEgp(amount)} ${s.t('egp')}\n${_phone.text.trim()}', textDirection: TextDirection.ltr),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: Text(s.t('cancel'))),
          FilledButton(
            style: FilledButton.styleFrom(minimumSize: const Size(100, 44)),
            onPressed: () => Navigator.pop(ctx, true),
            child: Text(s.t('confirm')),
          ),
        ],
      ),
    );
    if (ok != true || !mounted) return;

    // Same inputs retry with the same key (a lost response can never double-send);
    // changed inputs get a new key (a replay can never silently ignore a new amount).
    final fp = '${_phone.text.trim()}|$amount|${_note.text.trim()}';
    if (fp != _fp) {
      _fp = fp;
      _key = newKey();
    }
    setState(() => _busy = true);
    try {
      await s.send(_phone.text.trim(), amount, _note.text.trim(), _key);
      if (!mounted) return;
      Navigator.of(context).pushReplacement(MaterialPageRoute(
        builder: (_) => ReceiptScreen(amount: amount, toPhone: _phone.text.trim(), at: DateTime.now()),
      ));
    } on ApiException catch (e) {
      if (mounted) toast(context, s.errorText(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final s = AppScope.of(context);
    return Scaffold(
      appBar: AppBar(title: Text(s.t('send'))),
      body: ListView(
        padding: const EdgeInsets.all(20),
        children: [
          TextField(
            controller: _phone,
            keyboardType: TextInputType.phone,
            textDirection: TextDirection.ltr,
            decoration: InputDecoration(labelText: s.t('toPhone')),
          ),
          const SizedBox(height: 16),
          TextField(
            controller: _amount,
            keyboardType: const TextInputType.numberWithOptions(decimal: true),
            textDirection: TextDirection.ltr,
            style: const TextStyle(fontSize: 28, fontWeight: FontWeight.w700),
            decoration: InputDecoration(labelText: s.t('amountLabel')),
          ),
          const SizedBox(height: 16),
          TextField(controller: _note, decoration: InputDecoration(labelText: s.t('note'))),
          const SizedBox(height: 8),
          Text(s.t('free'), style: const TextStyle(color: muted)),
          const SizedBox(height: 24),
          FilledButton(
            onPressed: _busy ? null : _submit,
            child: _busy
                ? const SizedBox(height: 22, width: 22, child: CircularProgressIndicator(strokeWidth: 2))
                : Text(s.t('sendNow')),
          ),
        ],
      ),
    );
  }
}

class ReceiptScreen extends StatelessWidget {
  const ReceiptScreen({super.key, required this.amount, required this.toPhone, required this.at});
  final int amount;
  final String toPhone;
  final DateTime at;

  @override
  Widget build(BuildContext context) {
    final s = AppScope.of(context);
    Widget row(String k, String v) => Padding(
          padding: const EdgeInsets.symmetric(vertical: 10),
          child: Row(children: [
            Expanded(child: Text(k, style: const TextStyle(color: muted))),
            Text(v, textDirection: TextDirection.ltr, style: const TextStyle(fontWeight: FontWeight.w700)),
          ]),
        );
    return Scaffold(
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            children: [
              const SizedBox(height: 48),
              const CircleAvatar(radius: 42, backgroundColor: lime, foregroundColor: ink, child: Icon(Icons.check, size: 44)),
              const SizedBox(height: 16),
              Text(s.t('sent'), style: const TextStyle(fontSize: 24, fontWeight: FontWeight.w800)),
              const SizedBox(height: 8),
              Text('${formatEgp(amount)} ${s.t('egp')}',
                  textDirection: TextDirection.ltr, style: const TextStyle(fontSize: 40, fontWeight: FontWeight.w800)),
              const SizedBox(height: 24),
              Card(
                child: Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
                  child: Column(children: [row(s.t('to'), toPhone), row(s.t('fee'), s.t('free')), row('', fmtDate(at))]),
                ),
              ),
              const Spacer(),
              FilledButton(onPressed: () => Navigator.of(context).popUntil((r) => r.isFirst), child: Text(s.t('backHome'))),
            ],
          ),
        ),
      ),
    );
  }
}
