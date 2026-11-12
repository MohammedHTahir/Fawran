import 'package:flutter/material.dart';
import 'api.dart';
import 'money.dart';
import 'state.dart';
import 'theme.dart';

void toast(BuildContext c, String m) => ScaffoldMessenger.of(c).showSnackBar(SnackBar(content: Text(m)));

String fmtDate(DateTime d) {
  String p(int n) => n.toString().padLeft(2, '0');
  return '${d.year}-${p(d.month)}-${p(d.day)} ${p(d.hour)}:${p(d.minute)}';
}

class TxnTile extends StatelessWidget {
  const TxnTile(this.txn, {super.key});
  final Txn txn;

  @override
  Widget build(BuildContext context) {
    final s = AppScope.of(context);
    final incoming = txn.amount >= 0;
    return ListTile(
      leading: CircleAvatar(
        backgroundColor: incoming ? lime : const Color(0xFFE6EFEA),
        foregroundColor: ink,
        child: Icon(incoming ? Icons.south_west : Icons.north_east),
      ),
      title: Text(s.kindLabel(txn), style: const TextStyle(fontWeight: FontWeight.w600)),
      subtitle: Text(txn.memo == null || txn.memo!.startsWith('mock_') ? fmtDate(txn.createdAt) : txn.memo!),
      trailing: Text(
        '${incoming ? '+' : '-'}${formatEgp(txn.amount.abs())} ${s.t('egp')}',
        textDirection: TextDirection.ltr,
        style: TextStyle(fontWeight: FontWeight.w700, color: incoming ? positive : ink),
      ),
    );
  }
}
