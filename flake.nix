{
  description = "DevDen Blog Development Flake";

  inputs = {
    nixpkgs.url = "https://flakehub.com/f/NixOS/nixpkgs/0";
    # Only for biome since stable is a bit behind
    nixpkgs-unstable.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
    flake-parts.url = "github:hercules-ci/flake-parts";
    treefmt-nix = {
      url = "github:numtide/treefmt-nix";
      inputs.nixpkgs.follows = "nixpkgs";
    };
    git-hooks = {
      url = "github:cachix/git-hooks.nix";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs =
    inputs:
    inputs.flake-parts.lib.mkFlake { inherit inputs; } {
      systems = [
        "x86_64-linux"
        "aarch64-linux"
        "aarch64-darwin"
      ];

      imports = [ inputs.treefmt-nix.flakeModule inputs.git-hooks.flakeModule ];

      perSystem =
        { config
        , pkgs
        , system
        , ...
        }:
        {
          treefmt = {
            projectRootFile = "flake.nix";
            programs = {
              nixfmt.enable = true;
              yamlfmt.enable = true;
              actionlint.enable = true;
              biome = {
                enable = true;
                package = inputs.nixpkgs-unstable.legacyPackages.${system}.biome;
                settings = builtins.fromJSON (builtins.readFile ./biome.json);
                # the schema is a bit old so fails on a modern config
                validate.enable = false;
              };
            };
          };

          pre-commit.settings.hooks.nixpkgs-fmt.enable = true;

          devShells.default = pkgs.mkShellNoCC {
            inputsFrom = [ config.pre-commit.devShell ];
            packages = [
              pkgs.bun
              config.treefmt.build.wrapper
            ];
          };
        };
    };
}
