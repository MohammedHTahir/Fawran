import 'package:flutter/material.dart';
import '../api.dart';
import '../money.dart';
import '../state.dart';
import '../theme.dart';
import '../widgets.dart';
import 'link.dart';
import 'send.dart';

class HomeShell extends StatefulWidget {
  const HomeShell({super.key});
  @override
  State<HomeShell> createState() => _HomeShellState();
}

class _HomeShellState extends State<HomeShell> {
  int _i = 0;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) AppScope.of(context).refresh();
    });
  }

  @override
  Widget build(BuildContext context) {
    final s = AppScope.of(context);
    return Scaffold(
      body: SafeArea(child: IndexedStack(index: _i, children: const [HomeTab(), ActivityTab(), SettingsTab()])),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _i,
        onDestinationSelected: (i) => setState(() => _i = i),
        destinations: [
          NavigationDestination(icon: const Icon(Icons.home_outlined), selectedIcon: const Icon(Icons.home), label: s.t('home')),
          NavigationDestination(icon: const Icon(Icons.receipt_long_outlined), selectedIcon: const Icon(Icons.receipt_long), label: s.t('activity')),
          NavigationDestination(icon: const Icon(Icons.person_outline), selectedIcon: const Icon(Icons.person), label: s.t('account')),
        ],
      ),
    );
  }
}

class HomeTab extends StatelessWidget {
  const HomeTab({super.key});

  @override
  Widget build(BuildContext context) {
    final s = AppScope.of(context);
    void push(Widget w) => Navigator.of(context).push(MaterialPageRoute(builder: (_) => w));
    return RefreshIndicator(
      onRefresh: s.refresh,
      child: ListView(
        padding: const EdgeInsets.all(20),
        children: [
          Text(s.t('appName'), style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w800, color: teal)),
          const SizedBox(height: 12),
          Container(
            padding: const EdgeInsets.all(22),
            decoration: BoxDecoration(color: teal, borderRadius: BorderRadius.circular(24)),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(s.t('balance'), style: const TextStyle(color: Colors.white)),
                const SizedBox(height: 4),
                Text('${formatEgp(s.balance)} ${s.t('egp')}',
                    textDirection: TextDirection.ltr,
                    style: const TextStyle(color: Colors.white, fontSize: 36, fontWeight: FontWeight.w700)),
                const SizedBox(height: 14),
                FilledButton(
                  style: FilledButton.styleFrom(
                      backgroundColor: lime, foregroundColor: ink, minimumSize: const Size(0, 44)),
                  onPressed: () => showModalBottomSheet<void>(
                    context: context,
                    isScrollControlled: true,
                    builder: (_) => const TopupSheet(),
                  ),
                  child: Text(s.t('addBalance')),
                ),
              ],
            ),
          ),
          const SizedBox(height: 20),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceAround,
            children: [
              _Action(Icons.north_east, s.t('send'), () => push(const SendScreen())),
              _Action(Icons.south_west, s.t('request'), () => toast(context, s.t('soon'))),
              _Action(Icons.link, s.t('paymentLink'), () => push(const LinkScreen())),
              _Action(Icons.groups_outlined, s.t('split'), () => toast(context, s.t('soon'))),
            ],
          ),
          const SizedBox(height: 24),
          Text(s.t('recent'), style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w700)),
          const SizedBox(height: 8),
          if (s.txns.isEmpty)
            Padding(padding: const EdgeInsets.all(24), child: Center(child: Text(s.t('noTxns'), style: const TextStyle(color: muted))))
          else
            Card(child: Column(children: [for (final x in s.txns.take(5)) TxnTile(x)])),
        ],
      ),
    );
  }
}

class _Action extends StatelessWidget {
  const _Action(this.icon, this.label, this.onTap);
  final IconData icon;
  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      borderRadius: BorderRadius.circular(16),
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.all(6),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            CircleAvatar(radius: 28, backgroundColor: Colors.white, foregroundColor: ink, child: Icon(icon)),
            const SizedBox(height: 6),
            Text(label, style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600)),
          ],
        ),
      ),
    );
  }
}

class TopupSheet extends StatefulWidget {
  const TopupSheet({super.key});
  @override
  State<TopupSheet> createState() => _TopupSheetState();
}

class _TopupSheetState extends State<TopupSheet> {
  final _amount = TextEditingController();
  String _method = 'instapay';
  bool _busy = false;
  String _fp = '';
  String _key = newKey();

  @override
  void dispose() {
    _amount.dispose();
    super.dispose();
  }

  Future<void> _go() async {
    final s = AppScope.of(context);
    final amount = parseEgp(_amount.text);
    if (amount == null) {
      toast(context, s.t('errInvalidAmount'));
      return;
    }
    // A retry of the same request reuses the key (safe); a changed request gets a new key.
    final fp = '$amount|$_method';
    if (fp != _fp) {
      _fp = fp;
      _key = newKey();
    }
    setState(() => _busy = true);
    try {
      await s.topup(amount, _method, _key);
      if (mounted) Navigator.of(context).pop();
    } on ApiException catch (e) {
      if (mounted) toast(context, s.errorText(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final s = AppScope.of(context);
    return Padding(
      padding: EdgeInsets.fromLTRB(20, 20, 20, 20 + MediaQuery.of(context).viewInsets.bottom),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(s.t('topupTitle'), style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w700)),
          const SizedBox(height: 16),
          TextField(
            controller: _amount,
            keyboardType: const TextInputType.numberWithOptions(decimal: true),
            textDirection: TextDirection.ltr,
            decoration: InputDecoration(labelText: s.t('amountLabel')),
          ),
          const SizedBox(height: 12),
          Wrap(
            spacing: 8,
            children: [
              for (final m in ['instapay', 'card', 'wallet'])
                ChoiceChip(label: Text(s.t(m)), selected: _method == m, onSelected: (_) => setState(() => _method = m)),
            ],
          ),
          const SizedBox(height: 16),
          FilledButton(onPressed: _busy ? null : _go, child: Text(s.t('topupNow'))),
        ],
      ),
    );
  }
}

class ActivityTab extends StatelessWidget {
  const ActivityTab({super.key});

  @override
  Widget build(BuildContext context) {
    final s = AppScope.of(context);
    return RefreshIndicator(
      onRefresh: s.refresh,
      child: s.txns.isEmpty
          ? ListView(children: [Padding(padding: const EdgeInsets.all(48), child: Center(child: Text(s.t('noTxns'), style: const TextStyle(color: muted))))])
          : ListView(padding: const EdgeInsets.all(20), children: [Card(child: Column(children: [for (final x in s.txns) TxnTile(x)]))]),
    );
  }
}

class SettingsTab extends StatelessWidget {
  const SettingsTab({super.key});

  @override
  Widget build(BuildContext context) {
    final s = AppScope.of(context);
    return ListView(
      padding: const EdgeInsets.all(20),
      children: [
        Card(
          child: ListTile(
            leading: const CircleAvatar(backgroundColor: Color(0xFFE6EFEA), foregroundColor: teal, child: Icon(Icons.person)),
            title: Text(s.phone ?? '', textDirection: TextDirection.ltr, style: const TextStyle(fontWeight: FontWeight.w700)),
          ),
        ),
        const SizedBox(height: 16),
        Text(s.t('language'), style: const TextStyle(fontWeight: FontWeight.w600)),
        const SizedBox(height: 8),
        SegmentedButton<String>(
          segments: const [
            ButtonSegment(value: 'ar', label: Text('العربية')),
            ButtonSegment(value: 'en', label: Text('English')),
          ],
          selected: {s.lang},
          onSelectionChanged: (v) => s.setLang(v.first),
        ),
        const SizedBox(height: 24),
        OutlinedButton(
          style: OutlinedButton.styleFrom(minimumSize: const Size.fromHeight(52)),
          onPressed: () {
            Navigator.of(context).popUntil((r) => r.isFirst);
            s.logout();
          },
          child: Text(s.t('logout')),
        ),
      ],
    );
  }
}
