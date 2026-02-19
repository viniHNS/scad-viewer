# SCAD Web

Compile e visualize arquivos **OpenSCAD (.scad)** direto no navegador

## Features

- Upload de `.scad` via drag-and-drop
- Compilação com [openscad-wasm](https://github.com/openscad/openscad-wasm) (WebAssembly)
- Visualização 3D interativa (Three.js)
- Editor de parâmetros com sliders, dropdowns e toggles
- Download do STL gerado

## Como usar

1. Abra o site
2. Arraste um arquivo `.scad`
3. Ajuste os parâmetros (se houver)
4. Clique **Compilar**

### Parâmetros automáticos

Adicione anotações nos comentários do `.scad`:

```scad
// [Dimensões]
altura = 10;         // [1:0.5:50]      → slider
tipo = "redondo";    // [redondo, quadrado] → dropdown
ativo = true;        //                  → toggle
```

