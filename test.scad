// Arquivo de teste para o SCAD Web Viewer
// Os parâmetros abaixo serão detectados automaticamente

// [Dimensões]
tamanho_cubo = 30; // [10:100]
raio_esfera = 19; // [5:0.5:40]

// [Opções]
tipo = "diferenca"; // [diferenca, uniao, intersecao]
resolucao = 64; // [16, 32, 64, 128]
centralizado = true;

if (tipo == "diferenca") {
    difference() {
        cube([tamanho_cubo, tamanho_cubo, tamanho_cubo], center=centralizado);
        sphere(r=raio_esfera, $fn=resolucao);
    }
} else if (tipo == "uniao") {
    union() {
        cube([tamanho_cubo, tamanho_cubo, tamanho_cubo], center=centralizado);
        sphere(r=raio_esfera, $fn=resolucao);
    }
} else {
    intersection() {
        cube([tamanho_cubo, tamanho_cubo, tamanho_cubo], center=centralizado);
        sphere(r=raio_esfera, $fn=resolucao);
    }
}
