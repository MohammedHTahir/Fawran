import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'api.dart';
import 'screens/home.dart';
import 'screens/login.dart';
import 'state.dart';
import 'theme.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  final state = AppState(ApiClient());
  await state.init();
  runApp(FawranApp(state));
}

class FawranApp extends StatelessWidget {
  const FawranApp(this.state, {super.key});
  final AppState state;

  @override
  Widget build(BuildContext context) {
    return AppScope(
      state: state,
      child: ListenableBuilder(
        listenable: state,
        builder: (context, _) => MaterialApp(
          debugShowCheckedModeBanner: false,
          title: state.t('appName'),
          theme: buildTheme(),
          locale: Locale(state.lang),
          supportedLocales: const [Locale('ar'), Locale('en')],
          localizationsDelegates: const [
            GlobalMaterialLocalizations.delegate,
            GlobalWidgetsLocalizations.delegate,
            GlobalCupertinoLocalizations.delegate,
          ],
          home: state.loggedIn ? const HomeShell() : const LoginScreen(),
        ),
      ),
    );
  }
}
