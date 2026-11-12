import 'package:flutter/material.dart';

const ink = Color(0xFF0E2A2B);
const teal = Color(0xFF0F5C58);
const lime = Color(0xFFD9F26B);
const bgColor = Color(0xFFF4F6F3);
const muted = Color(0xFF55686A);
const positive = Color(0xFF0A7A4B);

ThemeData buildTheme() => ThemeData(
      useMaterial3: true,
      colorScheme: ColorScheme.fromSeed(seedColor: teal, primary: teal, surface: Colors.white),
      scaffoldBackgroundColor: bgColor,
      appBarTheme: const AppBarTheme(backgroundColor: bgColor, foregroundColor: ink, elevation: 0),
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          minimumSize: const Size.fromHeight(56),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
          textStyle: const TextStyle(fontSize: 17, fontWeight: FontWeight.w700),
        ),
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: Colors.white,
        border: OutlineInputBorder(borderRadius: BorderRadius.circular(14), borderSide: BorderSide.none),
      ),
      cardTheme: CardThemeData(
        color: Colors.white,
        elevation: 0,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
      ),
    );
