import 'brand_logo.dart';
import '../core/l10n.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../core/theme.dart';
import '../screens/app_settings_screen.dart';

/// Patient sign-in with Human Care branding and accessible controls.
class LoginShell extends StatelessWidget {
  const LoginShell(
      {super.key,
      required this.title,
      required this.contentBuilder,
      this.showBack = false,
      this.footer});
  final String title;
  final WidgetBuilder contentBuilder;
  final bool showBack;
  final Widget? footer;

  @override
  Widget build(BuildContext context) {
    Localizations.localeOf(context);
    final palette = AppPalette.of(context);
    final base = Theme.of(context);
    final border = OutlineInputBorder(
        borderRadius: BorderRadius.circular(20),
        borderSide: BorderSide(color: palette.line));
    final theme = base.copyWith(
      colorScheme: base.colorScheme.copyWith(
          primary: palette.action,
          onPrimary: palette.onAction,
          surface: palette.surface,
          onSurface: palette.ink,
          secondary: palette.petrol,
          error: palette.clay),
      textTheme: base.textTheme.copyWith(
        bodyMedium: base.textTheme.bodyMedium
            ?.copyWith(fontSize: 16, height: 1.5, color: palette.inkSoft),
        titleLarge: base.textTheme.titleLarge?.copyWith(
            fontSize: 22,
            height: 1.3,
            fontWeight: FontWeight.w700,
            color: palette.ink),
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: palette.surface,
        labelStyle: TextStyle(fontFamily: 'OpenSans', color: palette.inkSoft),
        hintStyle: TextStyle(fontFamily: 'OpenSans', color: palette.inkSoft),
        prefixIconColor: palette.petrol,
        suffixIconColor: palette.petrol,
        contentPadding:
            const EdgeInsets.symmetric(horizontal: 16, vertical: 17),
        border: border,
        enabledBorder: border,
        focusedBorder: border.copyWith(
            borderSide: BorderSide(color: palette.petrol, width: 1.6)),
      ),
      filledButtonTheme: FilledButtonThemeData(
          style: FilledButton.styleFrom(
        backgroundColor: palette.action,
        foregroundColor: palette.onAction,
        minimumSize: const Size.fromHeight(52),
        textStyle: const TextStyle(
            fontFamily: 'OpenSans', fontSize: 16, fontWeight: FontWeight.w700),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(28)),
      )),
      textButtonTheme: TextButtonThemeData(
          style: TextButton.styleFrom(
        foregroundColor: palette.petrol,
        minimumSize: const Size(48, 48),
        textStyle: const TextStyle(
            fontFamily: 'OpenSans', fontSize: 15, fontWeight: FontWeight.w600),
      )),
    );
    return Theme(
        data: theme,
        child: Builder(
            builder: (context) => AnnotatedRegion<SystemUiOverlayStyle>(
                  value: SystemUiOverlayStyle(
                      statusBarColor: Colors.transparent,
                      statusBarIconBrightness: Brightness.light,
                      systemNavigationBarColor: palette.surface,
                      systemNavigationBarIconBrightness:
                          base.brightness == Brightness.dark
                              ? Brightness.light
                              : Brightness.dark),
                  child: Scaffold(
                      backgroundColor: palette.heroStart,
                      body: SafeArea(
                          bottom: false,
                          child: Center(
                              child: ConstrainedBox(
                            constraints: const BoxConstraints(maxWidth: 560),
                            child: CustomScrollView(
                                keyboardDismissBehavior:
                                    ScrollViewKeyboardDismissBehavior.onDrag,
                                slivers: [
                                  SliverToBoxAdapter(
                                      child: _header(context, palette)),
                                  SliverFillRemaining(
                                      hasScrollBody: false,
                                      child: Container(
                                        decoration: BoxDecoration(
                                            color: palette.surface,
                                            borderRadius:
                                                const BorderRadius.vertical(
                                                    top: Radius.circular(28))),
                                        padding: EdgeInsets.fromLTRB(
                                            26,
                                            30,
                                            26,
                                            18 +
                                                MediaQuery.paddingOf(context)
                                                    .bottom),
                                        child: Column(
                                            crossAxisAlignment:
                                                CrossAxisAlignment.stretch,
                                            children: [
                                              const Center(
                                                  child: BrandLogo(
                                                      width: 190, height: 54)),
                                              const SizedBox(height: 28),
                                              contentBuilder(context),
                                              const SizedBox(height: 24),
                                              const Spacer(),
                                              if (footer != null) footer!,
                                              const SizedBox(height: 12),
                                              Divider(color: palette.line),
                                              const SizedBox(height: 10),
                                              Text('A-Health',
                                                  textAlign: TextAlign.center,
                                                  style: TextStyle(
                                                      fontFamily: 'OpenSans',
                                                      color: palette.inkSoft,
                                                      fontSize: 13,
                                                      fontWeight:
                                                          FontWeight.w600)),
                                            ]),
                                      )),
                                ]),
                          )))),
                )));
  }

  Widget _header(BuildContext context, AppPalette palette) => DecoratedBox(
        decoration: BoxDecoration(color: palette.deepOcean),
        child: Padding(
          padding: EdgeInsets.fromLTRB(showBack ? 12 : 26, 14, 26, 28),
          child:
              Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Row(children: [
              if (showBack)
                BackButton(
                    color: Colors.white,
                    onPressed: () => Navigator.of(context).maybePop()),
              const Expanded(
                  child: Align(
                      alignment: Alignment.centerLeft,
                      child: BrandLogo(
                          white: true,
                          symbolOnly: true,
                          width: 40,
                          height: 40))),
              IconButton(
                  tooltip: L.tr('Lugha na mwonekano'),
                  color: Colors.white,
                  icon: const Icon(Icons.language_rounded),
                  onPressed: () => Navigator.of(context).push(MaterialPageRoute(
                      builder: (_) => const AppSettingsScreen()))),
              const Icon(Icons.lock_outline_rounded,
                  color: Colors.white, size: 20),
            ]),
            const SizedBox(height: 26),
            Padding(
                padding: EdgeInsets.only(left: showBack ? 14 : 0),
                child: Text(L.tr(title),
                    style: const TextStyle(
                        fontFamily: 'OpenSans',
                        color: Colors.white,
                        fontSize: 28,
                        height: 1.2,
                        fontWeight: FontWeight.w700))),
            const SizedBox(height: 10),
            Container(
                margin: EdgeInsets.only(left: showBack ? 14 : 0),
                width: 38,
                height: 3,
                decoration: BoxDecoration(
                    color: Colors.white,
                    borderRadius: BorderRadius.circular(2))),
          ]),
        ),
      );
}
