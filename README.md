# SCAD Web

![GitHub repo size](https://img.shields.io/github/repo-size/viniHNS/scad-viewer?style=for-the-badge)
![GitHub language count](https://img.shields.io/github/languages/count/viniHNS/scad-viewer?style=for-the-badge)
![GitHub forks](https://img.shields.io/github/forks/viniHNS/scad-viewer?style=for-the-badge)
![Bitbucket open issues](https://img.shields.io/bitbucket/issues/viniHNS/scad-viewer?style=for-the-badge)
![Bitbucket open pull requests](https://img.shields.io/bitbucket/pr-raw/viniHNS/scad-viewer?style=for-the-badge)

<img src="scad.png" alt="SCAD Web Preview">

> Compile e visualize arquivos **OpenSCAD (.scad)** diretamente no navegador usando WebAssembly. Arraste seu arquivo, ajuste parâmetros com sliders e dropdowns interativos, e exporte o modelo 3D como STL — sem instalar nada.

**Acesse online:** [https://vinihns.github.io/scad-viewer/](https://vinihns.github.io/scad-viewer/)

### Ajustes e melhorias

O projeto ainda está em desenvolvimento e as próximas atualizações serão voltadas para as seguintes tarefas:

- [x] Upload de arquivos `.scad` via drag-and-drop
- [x] Compilação com OpenSCAD WASM (WebAssembly)
- [x] Visualização 3D interativa com Three.js
- [x] Editor de parâmetros automático (sliders, dropdowns, toggles)
- [x] Suporte à biblioteca BOSL2 (carregamento automático via CDN)
- [x] Download do STL gerado
- [ ] Suporte a múltiplos arquivos / includes locais
- [ ] Editor de código integrado
- [ ] Histórico de compilações

## Pré-requisitos

Antes de começar, verifique se você atendeu aos seguintes requisitos:

- Você tem um navegador moderno com suporte a **WebAssembly** (Chrome, Firefox, Edge, Safari)
- Você tem uma máquina `Windows / Linux / Mac` — o app roda inteiramente no navegador
- Para rodar localmente, você precisa de um servidor HTTP estático (ex: `npx serve`, `python -m http.server`, VS Code Live Server)

## Instalando SCAD Web

Para instalar o SCAD Web localmente, siga estas etapas:

Linux e macOS:

```bash
git clone https://github.com/viniHNS/scad-viewer.git
cd scad-viewer
npx serve .
```

Windows:

```bash
git clone https://github.com/viniHNS/scad-viewer.git
cd scad-viewer
npx serve .
```

> **Nota:** O projeto usa ES Modules e `importmap`, então é necessário servir via HTTP (não funciona abrindo o `index.html` diretamente).

## Usando SCAD Web

Para usar o SCAD Web, siga estas etapas:

1. Abra o site no navegador
2. Arraste um arquivo `.scad` para a área de upload (ou clique para selecionar)
3. Ajuste os parâmetros no painel lateral (se disponíveis)
4. Clique em **Compilar**
5. Interaja com o modelo 3D (rotacionar, zoom, mover câmera)
6. Clique em **Baixar STL** para exportar

### Parâmetros automáticos

Adicione anotações nos comentários do `.scad` para gerar controles interativos:

```scad
// [Dimensões]
tamanho = 30;        // [10:100]         → slider (min:max)
raio = 19;           // [5:0.5:40]       → slider (min:step:max)

// [Opções]
tipo = "redondo";    // [redondo, quadrado] → dropdown
resolucao = 64;      // [16, 32, 64, 128]  → dropdown numérico
ativo = true;                              // → toggle
nome = "teste";                            // → campo de texto
```

### Controles do visualizador

| Ação              | Controle                        |
| ----------------- | ------------------------------- |
| Rotacionar        | Clique esquerdo + arrastar      |
| Zoom              | Scroll do mouse                 |
| Mover câmera      | Clique direito + arrastar       |
| Resetar câmera    | Botão "Resetar" na toolbar      |

## Tecnologias

- [OpenSCAD WASM](https://github.com/openscad/openscad-wasm) — compilação de `.scad` via WebAssembly
- [Three.js](https://threejs.org/) — renderização 3D no navegador
- [BOSL2](https://github.com/BelfrySCAD/BOSL2) — biblioteca OpenSCAD carregada automaticamente quando detectada
- HTML/CSS/JS vanilla — sem frameworks, sem build step

## Contribuindo para SCAD Web

Para contribuir com o SCAD Web, siga estas etapas:

1. Bifurque este repositório.
2. Crie um branch: `git checkout -b <nome_branch>`.
3. Faça suas alterações e confirme-as: `git commit -m '<mensagem_commit>'`
4. Envie para o branch original: `git push origin <nome_branch>`
5. Crie a solicitação de pull.

Como alternativa, consulte a documentação do GitHub em [como criar uma solicitação pull](https://help.github.com/en/github/collaborating-with-issues-and-pull-requests/creating-a-pull-request).

## Licença

Esse projeto está sob licença MIT. Veja o arquivo [LICENÇA](LICENSE) para mais detalhes.
