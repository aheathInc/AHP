import 'package:flutter/material.dart';

/// Original Human Care artwork, with no additional symbols or visual effects.
class BrandLogo extends StatelessWidget {
  const BrandLogo(
      {super.key,
      this.white = false,
      this.symbolOnly = false,
      this.width = 180,
      this.height = 50});
  final bool white;
  final bool symbolOnly;
  final double width;
  final double height;
  @override
  Widget build(BuildContext context) {
    final useWhite = white || Theme.of(context).brightness == Brightness.dark;
    final arrangement = symbolOnly ? 'symbol' : 'horizontal';
    final variant = useWhite ? 'white' : 'full_colour';
    return Semantics(
        label: 'A-Health',
        image: true,
        child: ExcludeSemantics(
          child: Image.asset('assets/brand/${arrangement}_$variant.png',
              width: width, height: height, fit: BoxFit.contain),
        ));
  }
}
