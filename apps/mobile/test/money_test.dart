import 'package:flutter_test/flutter_test.dart';
import 'package:fawran_app/money.dart';

void main() {
  test('formatEgp', () {
    expect(formatEgp(0), '0.00');
    expect(formatEgp(5), '0.05');
    expect(formatEgp(1245000), '12,450.00');
    expect(formatEgp(-30000), '-300.00');
  });
  test('parseEgp', () {
    expect(parseEgp('500'), 50000);
    expect(parseEgp('12.5'), 1250);
    expect(parseEgp('12.50'), 1250);
    expect(parseEgp('0'), isNull);
    expect(parseEgp('-5'), isNull);
    expect(parseEgp('1.234'), isNull);
    expect(parseEgp('abc'), isNull);
    expect(parseEgp(''), isNull);
  });
  test('isEgyptianMobile', () {
    expect(isEgyptianMobile('01012345678'), isTrue);
    expect(isEgyptianMobile('+20 101 234 5678'), isTrue);
    expect(isEgyptianMobile('1012345678'), isFalse);
    expect(isEgyptianMobile('01312345678'), isFalse);
  });
}
