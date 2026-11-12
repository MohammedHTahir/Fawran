/// Money is always an integer number of piasters (1 EGP = 100). Never use double for money.
String formatEgp(int piasters) {
  final neg = piasters < 0;
  final v = piasters.abs();
  final whole = (v ~/ 100).toString();
  final frac = (v % 100).toString().padLeft(2, '0');
  final b = StringBuffer();
  for (var i = 0; i < whole.length; i++) {
    if (i > 0 && (whole.length - i) % 3 == 0) b.write(',');
    b.write(whole[i]);
  }
  return '${neg ? '-' : ''}$b.$frac';
}

/// Parses "12", "12.5" or "12.50" into piasters. Returns null if invalid or not positive.
int? parseEgp(String input) {
  final m = RegExp(r'^(\d{1,7})(?:\.(\d{1,2}))?$').firstMatch(input.trim());
  if (m == null) return null;
  final whole = int.parse(m.group(1)!);
  final frac = int.parse((m.group(2) ?? '').padRight(2, '0'));
  final v = whole * 100 + frac;
  return v > 0 ? v : null;
}

/// Accepts the same formats as the backend: 01xxxxxxxxx, +201xxxxxxxxx, 00201xxxxxxxxx.
bool isEgyptianMobile(String raw) =>
    RegExp(r'^(\+20|0020|0)1[0125]\d{8}$').hasMatch(raw.replaceAll(RegExp(r'[\s-]'), ''));
