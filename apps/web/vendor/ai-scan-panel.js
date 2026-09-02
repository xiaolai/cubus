var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// ../../node_modules/.pnpm/cubejs@1.3.2/node_modules/cubejs/lib/cube.js
var require_cube = __commonJS({
  "../../node_modules/.pnpm/cubejs@1.3.2/node_modules/cubejs/lib/cube.js"(exports, module) {
    (function() {
      var B, BL, BR, Cube3, D, DB, DBL, DF, DFR, DL, DLF, DR, DRB, F, FL, FR, L, R, U, UB, UBR, UF, UFL, UL, ULB, UR, URF, centerColor, centerFacelet, cornerColor, cornerFacelet, edgeColor, edgeFacelet;
      [U, R, F, D, L, B] = [0, 1, 2, 3, 4, 5];
      [URF, UFL, ULB, UBR, DFR, DLF, DBL, DRB] = [0, 1, 2, 3, 4, 5, 6, 7];
      [UR, UF, UL, UB, DR, DF, DL, DB, FR, FL, BL, BR] = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
      [centerFacelet, cornerFacelet, edgeFacelet] = function() {
        var _B, _D, _F, _L, _R, _U;
        _U = function(x) {
          return x - 1;
        };
        _R = function(x) {
          return _U(9) + x;
        };
        _F = function(x) {
          return _R(9) + x;
        };
        _D = function(x) {
          return _F(9) + x;
        };
        _L = function(x) {
          return _D(9) + x;
        };
        _B = function(x) {
          return _L(9) + x;
        };
        return [
          // Centers
          [
            4,
            13,
            22,
            31,
            40,
            49
          ],
          // Corners
          [
            [
              _U(9),
              _R(1),
              _F(3)
            ],
            [
              _U(7),
              _F(1),
              _L(3)
            ],
            [
              _U(1),
              _L(1),
              _B(3)
            ],
            [
              _U(3),
              _B(1),
              _R(3)
            ],
            [
              _D(3),
              _F(9),
              _R(7)
            ],
            [
              _D(1),
              _L(9),
              _F(7)
            ],
            [
              _D(7),
              _B(9),
              _L(7)
            ],
            [
              _D(9),
              _R(9),
              _B(7)
            ]
          ],
          // Edges
          [
            [
              _U(6),
              _R(2)
            ],
            [
              _U(8),
              _F(2)
            ],
            [
              _U(4),
              _L(2)
            ],
            [
              _U(2),
              _B(2)
            ],
            [
              _D(6),
              _R(8)
            ],
            [
              _D(2),
              _F(8)
            ],
            [
              _D(4),
              _L(8)
            ],
            [
              _D(8),
              _B(8)
            ],
            [
              _F(6),
              _R(4)
            ],
            [
              _F(4),
              _L(6)
            ],
            [
              _B(6),
              _L(4)
            ],
            [
              _B(4),
              _R(6)
            ]
          ]
        ];
      }();
      centerColor = ["U", "R", "F", "D", "L", "B"];
      cornerColor = [["U", "R", "F"], ["U", "F", "L"], ["U", "L", "B"], ["U", "B", "R"], ["D", "F", "R"], ["D", "L", "F"], ["D", "B", "L"], ["D", "R", "B"]];
      edgeColor = [["U", "R"], ["U", "F"], ["U", "L"], ["U", "B"], ["D", "R"], ["D", "F"], ["D", "L"], ["D", "B"], ["F", "R"], ["F", "L"], ["B", "L"], ["B", "R"]];
      Cube3 = function() {
        var faceNames, faceNums, parseAlg;
        class Cube4 {
          constructor(other) {
            var x;
            if (other != null) {
              this.init(other);
            } else {
              this.identity();
            }
            this.newCenter = function() {
              var k, results;
              results = [];
              for (x = k = 0; k <= 5; x = ++k) {
                results.push(0);
              }
              return results;
            }();
            this.newCp = function() {
              var k, results;
              results = [];
              for (x = k = 0; k <= 7; x = ++k) {
                results.push(0);
              }
              return results;
            }();
            this.newEp = function() {
              var k, results;
              results = [];
              for (x = k = 0; k <= 11; x = ++k) {
                results.push(0);
              }
              return results;
            }();
            this.newCo = function() {
              var k, results;
              results = [];
              for (x = k = 0; k <= 7; x = ++k) {
                results.push(0);
              }
              return results;
            }();
            this.newEo = function() {
              var k, results;
              results = [];
              for (x = k = 0; k <= 11; x = ++k) {
                results.push(0);
              }
              return results;
            }();
          }
          init(state) {
            this.center = state.center.slice(0);
            this.co = state.co.slice(0);
            this.ep = state.ep.slice(0);
            this.cp = state.cp.slice(0);
            return this.eo = state.eo.slice(0);
          }
          identity() {
            var x;
            this.center = [0, 1, 2, 3, 4, 5];
            this.cp = [0, 1, 2, 3, 4, 5, 6, 7];
            this.co = function() {
              var k, results;
              results = [];
              for (x = k = 0; k <= 7; x = ++k) {
                results.push(0);
              }
              return results;
            }();
            this.ep = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
            return this.eo = function() {
              var k, results;
              results = [];
              for (x = k = 0; k <= 11; x = ++k) {
                results.push(0);
              }
              return results;
            }();
          }
          toJSON() {
            return {
              center: this.center,
              cp: this.cp,
              co: this.co,
              ep: this.ep,
              eo: this.eo
            };
          }
          asString() {
            var corner, edge, i, k, l, m, n, o, ori, p, result;
            result = [];
            for (i = k = 0; k <= 5; i = ++k) {
              result[9 * i + 4] = centerColor[this.center[i]];
            }
            for (i = l = 0; l <= 7; i = ++l) {
              corner = this.cp[i];
              ori = this.co[i];
              for (n = m = 0; m <= 2; n = ++m) {
                result[cornerFacelet[i][(n + ori) % 3]] = cornerColor[corner][n];
              }
            }
            for (i = o = 0; o <= 11; i = ++o) {
              edge = this.ep[i];
              ori = this.eo[i];
              for (n = p = 0; p <= 1; n = ++p) {
                result[edgeFacelet[i][(n + ori) % 2]] = edgeColor[edge][n];
              }
            }
            return result.join("");
          }
          static fromString(str) {
            var col1, col2, cube, i, j, k, l, m, o, ori, p, q, r, ref;
            cube = new Cube4();
            for (i = k = 0; k <= 5; i = ++k) {
              for (j = l = 0; l <= 5; j = ++l) {
                if (str[9 * i + 4] === centerColor[j]) {
                  cube.center[i] = j;
                }
              }
            }
            for (i = m = 0; m <= 7; i = ++m) {
              for (ori = o = 0; o <= 2; ori = ++o) {
                if ((ref = str[cornerFacelet[i][ori]]) === "U" || ref === "D") {
                  break;
                }
              }
              col1 = str[cornerFacelet[i][(ori + 1) % 3]];
              col2 = str[cornerFacelet[i][(ori + 2) % 3]];
              for (j = p = 0; p <= 7; j = ++p) {
                if (col1 === cornerColor[j][1] && col2 === cornerColor[j][2]) {
                  cube.cp[i] = j;
                  cube.co[i] = ori % 3;
                }
              }
            }
            for (i = q = 0; q <= 11; i = ++q) {
              for (j = r = 0; r <= 11; j = ++r) {
                if (str[edgeFacelet[i][0]] === edgeColor[j][0] && str[edgeFacelet[i][1]] === edgeColor[j][1]) {
                  cube.ep[i] = j;
                  cube.eo[i] = 0;
                  break;
                }
                if (str[edgeFacelet[i][0]] === edgeColor[j][1] && str[edgeFacelet[i][1]] === edgeColor[j][0]) {
                  cube.ep[i] = j;
                  cube.eo[i] = 1;
                  break;
                }
              }
            }
            return cube;
          }
          clone() {
            return new Cube4(this.toJSON());
          }
          // A class method returning a new random cube
          static random() {
            return new Cube4().randomize();
          }
          isSolved() {
            var c, cent, clone, e, k, l, m;
            clone = this.clone();
            clone.move(clone.upright());
            for (cent = k = 0; k <= 5; cent = ++k) {
              if (clone.center[cent] !== cent) {
                return false;
              }
            }
            for (c = l = 0; l <= 7; c = ++l) {
              if (clone.cp[c] !== c) {
                return false;
              }
              if (clone.co[c] !== 0) {
                return false;
              }
            }
            for (e = m = 0; m <= 11; e = ++m) {
              if (clone.ep[e] !== e) {
                return false;
              }
              if (clone.eo[e] !== 0) {
                return false;
              }
            }
            return true;
          }
          // Multiply this Cube with another Cube, restricted to centers.
          centerMultiply(other) {
            var from, k, to;
            for (to = k = 0; k <= 5; to = ++k) {
              from = other.center[to];
              this.newCenter[to] = this.center[from];
            }
            [this.center, this.newCenter] = [this.newCenter, this.center];
            return this;
          }
          // Multiply this Cube with another Cube, restricted to corners.
          cornerMultiply(other) {
            var from, k, to;
            for (to = k = 0; k <= 7; to = ++k) {
              from = other.cp[to];
              this.newCp[to] = this.cp[from];
              this.newCo[to] = (this.co[from] + other.co[to]) % 3;
            }
            [this.cp, this.newCp] = [this.newCp, this.cp];
            [this.co, this.newCo] = [this.newCo, this.co];
            return this;
          }
          // Multiply this Cube with another Cube, restricted to edges
          edgeMultiply(other) {
            var from, k, to;
            for (to = k = 0; k <= 11; to = ++k) {
              from = other.ep[to];
              this.newEp[to] = this.ep[from];
              this.newEo[to] = (this.eo[from] + other.eo[to]) % 2;
            }
            [this.ep, this.newEp] = [this.newEp, this.ep];
            [this.eo, this.newEo] = [this.newEo, this.eo];
            return this;
          }
          // Multiply this cube with another Cube
          multiply(other) {
            this.centerMultiply(other);
            this.cornerMultiply(other);
            this.edgeMultiply(other);
            return this;
          }
          move(arg) {
            var face, k, l, len, move, power, ref, ref1, x;
            ref = parseAlg(arg);
            for (k = 0, len = ref.length; k < len; k++) {
              move = ref[k];
              face = move / 3 | 0;
              power = move % 3;
              for (x = l = 0, ref1 = power; 0 <= ref1 ? l <= ref1 : l >= ref1; x = 0 <= ref1 ? ++l : --l) {
                this.multiply(Cube4.moves[face]);
              }
            }
            return this;
          }
          upright() {
            var clone, i, j, k, l, result;
            clone = this.clone();
            result = [];
            for (i = k = 0; k <= 5; i = ++k) {
              if (clone.center[i] === F) {
                break;
              }
            }
            switch (i) {
              case D:
                result.push("x");
                break;
              case U:
                result.push("x'");
                break;
              case B:
                result.push("x2");
                break;
              case R:
                result.push("y");
                break;
              case L:
                result.push("y'");
            }
            if (result.length) {
              clone.move(result[0]);
            }
            for (j = l = 0; l <= 5; j = ++l) {
              if (clone.center[j] === U) {
                break;
              }
            }
            switch (j) {
              case L:
                result.push("z");
                break;
              case R:
                result.push("z'");
                break;
              case D:
                result.push("z2");
            }
            return result.join(" ");
          }
          static inverse(arg) {
            var face, k, len, move, power, result, str;
            result = function() {
              var k2, len2, ref, results;
              ref = parseAlg(arg);
              results = [];
              for (k2 = 0, len2 = ref.length; k2 < len2; k2++) {
                move = ref[k2];
                face = move / 3 | 0;
                power = move % 3;
                results.push(face * 3 + -(power - 1) + 1);
              }
              return results;
            }();
            result.reverse();
            if (typeof arg === "string") {
              str = "";
              for (k = 0, len = result.length; k < len; k++) {
                move = result[k];
                face = move / 3 | 0;
                power = move % 3;
                str += faceNames[face];
                if (power === 1) {
                  str += "2";
                } else if (power === 2) {
                  str += "'";
                }
                str += " ";
              }
              return str.substring(0, str.length - 1);
            } else if (arg.length != null) {
              return result;
            } else {
              return result[0];
            }
          }
        }
        ;
        Cube4.prototype.randomize = function() {
          var arePermutationsValid, generateValidRandomOrientation, generateValidRandomPermutation, getNumSwaps, isOrientationValid, randint, randomizeOrientation, result, shuffle;
          randint = function(min, max) {
            return min + Math.floor(Math.random() * (max - min + 1));
          };
          shuffle = function(array) {
            var currentIndex, randomIndex, temporaryValue;
            currentIndex = array.length;
            while (currentIndex !== 0) {
              randomIndex = randint(0, currentIndex - 1);
              currentIndex -= 1;
              temporaryValue = array[currentIndex];
              [array[currentIndex], array[randomIndex]] = [array[randomIndex], array[currentIndex]];
            }
          };
          getNumSwaps = function(arr) {
            var cur, cycleLength, i, k, numSwaps, ref, seen, x;
            numSwaps = 0;
            seen = function() {
              var k2, ref2, results;
              results = [];
              for (x = k2 = 0, ref2 = arr.length - 1; 0 <= ref2 ? k2 <= ref2 : k2 >= ref2; x = 0 <= ref2 ? ++k2 : --k2) {
                results.push(false);
              }
              return results;
            }();
            while (true) {
              cur = -1;
              for (i = k = 0, ref = arr.length - 1; 0 <= ref ? k <= ref : k >= ref; i = 0 <= ref ? ++k : --k) {
                if (!seen[i]) {
                  cur = i;
                  break;
                }
              }
              if (cur === -1) {
                break;
              }
              cycleLength = 0;
              while (!seen[cur]) {
                seen[cur] = true;
                cycleLength++;
                cur = arr[cur];
              }
              numSwaps += cycleLength + 1;
            }
            return numSwaps;
          };
          arePermutationsValid = function(cp, ep) {
            var numSwaps;
            numSwaps = getNumSwaps(ep) + getNumSwaps(cp);
            return numSwaps % 2 === 0;
          };
          generateValidRandomPermutation = function(cp, ep) {
            shuffle(ep);
            shuffle(cp);
            while (!arePermutationsValid(cp, ep)) {
              shuffle(ep);
              shuffle(cp);
            }
          };
          randomizeOrientation = function(arr, numOrientations) {
            var i, k, ori, ref;
            ori = 0;
            for (i = k = 0, ref = arr.length - 1; 0 <= ref ? k <= ref : k >= ref; i = 0 <= ref ? ++k : --k) {
              ori += arr[i] = randint(0, numOrientations - 1);
            }
          };
          isOrientationValid = function(arr, numOrientations) {
            return arr.reduce(function(a, b) {
              return a + b;
            }) % numOrientations === 0;
          };
          generateValidRandomOrientation = function(co, eo) {
            randomizeOrientation(co, 3);
            while (!isOrientationValid(co, 3)) {
              randomizeOrientation(co, 3);
            }
            randomizeOrientation(eo, 2);
            while (!isOrientationValid(eo, 2)) {
              randomizeOrientation(eo, 2);
            }
          };
          result = function() {
            generateValidRandomPermutation(this.cp, this.ep);
            generateValidRandomOrientation(this.co, this.eo);
            return this;
          };
          return result;
        }();
        Cube4.moves = [
          {
            // U
            center: [0, 1, 2, 3, 4, 5],
            cp: [
              UBR,
              URF,
              UFL,
              ULB,
              DFR,
              DLF,
              DBL,
              DRB
            ],
            co: [
              0,
              0,
              0,
              0,
              0,
              0,
              0,
              0
            ],
            ep: [
              UB,
              UR,
              UF,
              UL,
              DR,
              DF,
              DL,
              DB,
              FR,
              FL,
              BL,
              BR
            ],
            eo: [
              0,
              0,
              0,
              0,
              0,
              0,
              0,
              0,
              0,
              0,
              0,
              0
            ]
          },
          {
            // R
            center: [0, 1, 2, 3, 4, 5],
            cp: [
              DFR,
              UFL,
              ULB,
              URF,
              DRB,
              DLF,
              DBL,
              UBR
            ],
            co: [
              2,
              0,
              0,
              1,
              1,
              0,
              0,
              2
            ],
            ep: [
              FR,
              UF,
              UL,
              UB,
              BR,
              DF,
              DL,
              DB,
              DR,
              FL,
              BL,
              UR
            ],
            eo: [
              0,
              0,
              0,
              0,
              0,
              0,
              0,
              0,
              0,
              0,
              0,
              0
            ]
          },
          {
            // F
            center: [0, 1, 2, 3, 4, 5],
            cp: [
              UFL,
              DLF,
              ULB,
              UBR,
              URF,
              DFR,
              DBL,
              DRB
            ],
            co: [
              1,
              2,
              0,
              0,
              2,
              1,
              0,
              0
            ],
            ep: [
              UR,
              FL,
              UL,
              UB,
              DR,
              FR,
              DL,
              DB,
              UF,
              DF,
              BL,
              BR
            ],
            eo: [
              0,
              1,
              0,
              0,
              0,
              1,
              0,
              0,
              1,
              1,
              0,
              0
            ]
          },
          {
            // D
            center: [0, 1, 2, 3, 4, 5],
            cp: [
              URF,
              UFL,
              ULB,
              UBR,
              DLF,
              DBL,
              DRB,
              DFR
            ],
            co: [
              0,
              0,
              0,
              0,
              0,
              0,
              0,
              0
            ],
            ep: [
              UR,
              UF,
              UL,
              UB,
              DF,
              DL,
              DB,
              DR,
              FR,
              FL,
              BL,
              BR
            ],
            eo: [
              0,
              0,
              0,
              0,
              0,
              0,
              0,
              0,
              0,
              0,
              0,
              0
            ]
          },
          {
            // L
            center: [0, 1, 2, 3, 4, 5],
            cp: [
              URF,
              ULB,
              DBL,
              UBR,
              DFR,
              UFL,
              DLF,
              DRB
            ],
            co: [
              0,
              1,
              2,
              0,
              0,
              2,
              1,
              0
            ],
            ep: [
              UR,
              UF,
              BL,
              UB,
              DR,
              DF,
              FL,
              DB,
              FR,
              UL,
              DL,
              BR
            ],
            eo: [
              0,
              0,
              0,
              0,
              0,
              0,
              0,
              0,
              0,
              0,
              0,
              0
            ]
          },
          {
            // B
            center: [0, 1, 2, 3, 4, 5],
            cp: [
              URF,
              UFL,
              UBR,
              DRB,
              DFR,
              DLF,
              ULB,
              DBL
            ],
            co: [
              0,
              0,
              1,
              2,
              0,
              0,
              2,
              1
            ],
            ep: [
              UR,
              UF,
              UL,
              BR,
              DR,
              DF,
              DL,
              BL,
              FR,
              FL,
              UB,
              DB
            ],
            eo: [
              0,
              0,
              0,
              1,
              0,
              0,
              0,
              1,
              0,
              0,
              1,
              1
            ]
          },
          {
            // E
            center: [
              U,
              F,
              L,
              D,
              B,
              R
            ],
            cp: [
              URF,
              UFL,
              ULB,
              UBR,
              DFR,
              DLF,
              DBL,
              DRB
            ],
            co: [
              0,
              0,
              0,
              0,
              0,
              0,
              0,
              0
            ],
            ep: [
              UR,
              UF,
              UL,
              UB,
              DR,
              DF,
              DL,
              DB,
              FL,
              BL,
              BR,
              FR
            ],
            eo: [
              0,
              0,
              0,
              0,
              0,
              0,
              0,
              0,
              1,
              1,
              1,
              1
            ]
          },
          {
            // M
            center: [
              B,
              R,
              U,
              F,
              L,
              D
            ],
            cp: [
              URF,
              UFL,
              ULB,
              UBR,
              DFR,
              DLF,
              DBL,
              DRB
            ],
            co: [
              0,
              0,
              0,
              0,
              0,
              0,
              0,
              0
            ],
            ep: [
              UR,
              UB,
              UL,
              DB,
              DR,
              UF,
              DL,
              DF,
              FR,
              FL,
              BL,
              BR
            ],
            eo: [
              0,
              1,
              0,
              1,
              0,
              1,
              0,
              1,
              0,
              0,
              0,
              0
            ]
          },
          {
            // S
            center: [
              L,
              U,
              F,
              R,
              D,
              B
            ],
            cp: [
              URF,
              UFL,
              ULB,
              UBR,
              DFR,
              DLF,
              DBL,
              DRB
            ],
            co: [
              0,
              0,
              0,
              0,
              0,
              0,
              0,
              0
            ],
            ep: [
              UL,
              UF,
              DL,
              UB,
              UR,
              DF,
              DR,
              DB,
              FR,
              FL,
              BL,
              BR
            ],
            eo: [
              1,
              0,
              1,
              0,
              1,
              0,
              1,
              0,
              0,
              0,
              0,
              0
            ]
          }
        ];
        faceNums = {
          U: 0,
          R: 1,
          F: 2,
          D: 3,
          L: 4,
          B: 5,
          E: 6,
          M: 7,
          S: 8,
          x: 9,
          y: 10,
          z: 11,
          u: 12,
          r: 13,
          f: 14,
          d: 15,
          l: 16,
          b: 17
        };
        faceNames = {
          0: "U",
          1: "R",
          2: "F",
          3: "D",
          4: "L",
          5: "B",
          6: "E",
          7: "M",
          8: "S",
          9: "x",
          10: "y",
          11: "z",
          12: "u",
          13: "r",
          14: "f",
          15: "d",
          16: "l",
          17: "b"
        };
        parseAlg = function(arg) {
          var k, len, move, part, power, ref, results;
          if (typeof arg === "string") {
            ref = arg.split(/\s+/);
            results = [];
            for (k = 0, len = ref.length; k < len; k++) {
              part = ref[k];
              if (part.length === 0) {
                continue;
              }
              if (part.length > 2) {
                throw new Error(`Invalid move: ${part}`);
              }
              move = faceNums[part[0]];
              if (move === void 0) {
                throw new Error(`Invalid move: ${part}`);
              }
              if (part.length === 1) {
                power = 0;
              } else {
                if (part[1] === "2") {
                  power = 1;
                } else if (part[1] === "'") {
                  power = 2;
                } else {
                  throw new Error(`Invalid move: ${part}`);
                }
              }
              results.push(move * 3 + power);
            }
            return results;
          } else if (arg.length != null) {
            return arg;
          } else {
            return [arg];
          }
        };
        Cube4.moves.push(new Cube4().move("R M' L'").toJSON());
        Cube4.moves.push(new Cube4().move("U E' D'").toJSON());
        Cube4.moves.push(new Cube4().move("F S B'").toJSON());
        Cube4.moves.push(new Cube4().move("U E'").toJSON());
        Cube4.moves.push(new Cube4().move("R M'").toJSON());
        Cube4.moves.push(new Cube4().move("F S").toJSON());
        Cube4.moves.push(new Cube4().move("D E").toJSON());
        Cube4.moves.push(new Cube4().move("L M").toJSON());
        Cube4.moves.push(new Cube4().move("B S'").toJSON());
        return Cube4;
      }.call(this);
      if (typeof module !== "undefined" && module !== null) {
        module.exports = Cube3;
      } else {
        this.Cube = Cube3;
      }
    }).call(exports);
  }
});

// ../../node_modules/.pnpm/cubejs@1.3.2/node_modules/cubejs/lib/solve.js
var require_solve = __commonJS({
  "../../node_modules/.pnpm/cubejs@1.3.2/node_modules/cubejs/lib/solve.js"(exports) {
    (function() {
      var B, BL, BR, Cnk, Cube3, D, DB, DBL, DF, DFR, DL, DLF, DR, DRB, F, FL, FR, Include, L, N_FLIP, N_FRtoBR, N_PARITY, N_SLICE1, N_SLICE2, N_TWIST, N_UBtoDF, N_URFtoDLF, N_URtoDF, N_URtoUL, R, U, UB, UBR, UF, UFL, UL, ULB, UR, URF, allMoves1, allMoves2, computeMoveTable, computePruningTable, faceNames, faceNums, factorial, key, max, mergeURtoDF, moveTableParams, nextMoves1, nextMoves2, permutationIndex, pruning, pruningTableParams, rotateLeft, rotateRight, value, indexOf = [].indexOf;
      Cube3 = this.Cube || require_cube();
      [U, R, F, D, L, B] = [0, 1, 2, 3, 4, 5];
      [URF, UFL, ULB, UBR, DFR, DLF, DBL, DRB] = [0, 1, 2, 3, 4, 5, 6, 7];
      [UR, UF, UL, UB, DR, DF, DL, DB, FR, FL, BL, BR] = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
      Cnk = function(n, k) {
        var i, j, s;
        if (n < k) {
          return 0;
        }
        if (k > n / 2) {
          k = n - k;
        }
        s = 1;
        i = n;
        j = 1;
        while (i !== n - k) {
          s *= i;
          s /= j;
          i--;
          j++;
        }
        return s;
      };
      factorial = function(n) {
        var f, i, m, ref;
        f = 1;
        for (i = m = 2, ref = n; 2 <= ref ? m <= ref : m >= ref; i = 2 <= ref ? ++m : --m) {
          f *= i;
        }
        return f;
      };
      max = function(a, b) {
        if (a > b) {
          return a;
        } else {
          return b;
        }
      };
      rotateLeft = function(array, l, r) {
        var i, m, ref, ref1, tmp;
        tmp = array[l];
        for (i = m = ref = l, ref1 = r - 1; ref <= ref1 ? m <= ref1 : m >= ref1; i = ref <= ref1 ? ++m : --m) {
          array[i] = array[i + 1];
        }
        return array[r] = tmp;
      };
      rotateRight = function(array, l, r) {
        var i, m, ref, ref1, tmp;
        tmp = array[r];
        for (i = m = ref = r, ref1 = l + 1; ref <= ref1 ? m <= ref1 : m >= ref1; i = ref <= ref1 ? ++m : --m) {
          array[i] = array[i - 1];
        }
        return array[l] = tmp;
      };
      permutationIndex = function(context, start, end, fromEnd = false) {
        var i, maxAll, maxB, maxOur, our, permName;
        maxOur = end - start;
        maxB = factorial(maxOur + 1);
        if (context === "corners") {
          maxAll = 7;
          permName = "cp";
        } else {
          maxAll = 11;
          permName = "ep";
        }
        our = function() {
          var m, ref, results;
          results = [];
          for (i = m = 0, ref = maxOur; 0 <= ref ? m <= ref : m >= ref; i = 0 <= ref ? ++m : --m) {
            results.push(0);
          }
          return results;
        }();
        return function(index) {
          var a, b, c, j, k, m, o, p, perm, q, ref, ref1, ref10, ref2, ref3, ref4, ref5, ref6, ref7, ref8, ref9, t, u, w, x, y, z;
          if (index != null) {
            for (i = m = 0, ref = maxOur; 0 <= ref ? m <= ref : m >= ref; i = 0 <= ref ? ++m : --m) {
              our[i] = i + start;
            }
            b = index % maxB;
            a = index / maxB | 0;
            perm = this[permName];
            for (i = o = 0, ref1 = maxAll; 0 <= ref1 ? o <= ref1 : o >= ref1; i = 0 <= ref1 ? ++o : --o) {
              perm[i] = -1;
            }
            for (j = p = 1, ref2 = maxOur; 1 <= ref2 ? p <= ref2 : p >= ref2; j = 1 <= ref2 ? ++p : --p) {
              k = b % (j + 1);
              b = b / (j + 1) | 0;
              while (k > 0) {
                rotateRight(our, 0, j);
                k--;
              }
            }
            x = maxOur;
            if (fromEnd) {
              for (j = q = 0, ref3 = maxAll; 0 <= ref3 ? q <= ref3 : q >= ref3; j = 0 <= ref3 ? ++q : --q) {
                c = Cnk(maxAll - j, x + 1);
                if (a - c >= 0) {
                  perm[j] = our[maxOur - x];
                  a -= c;
                  x--;
                }
              }
            } else {
              for (j = t = ref4 = maxAll; ref4 <= 0 ? t <= 0 : t >= 0; j = ref4 <= 0 ? ++t : --t) {
                c = Cnk(j, x + 1);
                if (a - c >= 0) {
                  perm[j] = our[x];
                  a -= c;
                  x--;
                }
              }
            }
            return this;
          } else {
            perm = this[permName];
            for (i = u = 0, ref5 = maxOur; 0 <= ref5 ? u <= ref5 : u >= ref5; i = 0 <= ref5 ? ++u : --u) {
              our[i] = -1;
            }
            a = b = x = 0;
            if (fromEnd) {
              for (j = w = ref6 = maxAll; ref6 <= 0 ? w <= 0 : w >= 0; j = ref6 <= 0 ? ++w : --w) {
                if (start <= (ref7 = perm[j]) && ref7 <= end) {
                  a += Cnk(maxAll - j, x + 1);
                  our[maxOur - x] = perm[j];
                  x++;
                }
              }
            } else {
              for (j = y = 0, ref8 = maxAll; 0 <= ref8 ? y <= ref8 : y >= ref8; j = 0 <= ref8 ? ++y : --y) {
                if (start <= (ref9 = perm[j]) && ref9 <= end) {
                  a += Cnk(j, x + 1);
                  our[x] = perm[j];
                  x++;
                }
              }
            }
            for (j = z = ref10 = maxOur; ref10 <= 0 ? z <= 0 : z >= 0; j = ref10 <= 0 ? ++z : --z) {
              k = 0;
              while (our[j] !== start + j) {
                rotateLeft(our, 0, j);
                k++;
              }
              b = (j + 1) * b + k;
            }
            return a * maxB + b;
          }
        };
      };
      Include = {
        // The twist of the 8 corners, 0 <= twist < 3^7. The orientation of
        // the DRB corner is fully determined by the orientation of the other
        // corners.
        twist: function(twist) {
          var i, m, o, ori, parity2, v;
          if (twist != null) {
            parity2 = 0;
            for (i = m = 6; m >= 0; i = --m) {
              ori = twist % 3;
              twist = twist / 3 | 0;
              this.co[i] = ori;
              parity2 += ori;
            }
            this.co[7] = (3 - parity2 % 3) % 3;
            return this;
          } else {
            v = 0;
            for (i = o = 0; o <= 6; i = ++o) {
              v = 3 * v + this.co[i];
            }
            return v;
          }
        },
        // The flip of the 12 edges, 0 <= flip < 2^11. The orientation of the
        // BR edge is fully determined by the orientation of the other edges.
        flip: function(flip) {
          var i, m, o, ori, parity2, v;
          if (flip != null) {
            parity2 = 0;
            for (i = m = 10; m >= 0; i = --m) {
              ori = flip % 2;
              flip = flip / 2 | 0;
              this.eo[i] = ori;
              parity2 += ori;
            }
            this.eo[11] = (2 - parity2 % 2) % 2;
            return this;
          } else {
            v = 0;
            for (i = o = 0; o <= 10; i = ++o) {
              v = 2 * v + this.eo[i];
            }
            return v;
          }
        },
        // Parity of the corner permutation
        cornerParity: function() {
          var i, j, m, o, ref, ref1, ref2, ref3, s;
          s = 0;
          for (i = m = ref = DRB, ref1 = URF + 1; ref <= ref1 ? m <= ref1 : m >= ref1; i = ref <= ref1 ? ++m : --m) {
            for (j = o = ref2 = i - 1, ref3 = URF; ref2 <= ref3 ? o <= ref3 : o >= ref3; j = ref2 <= ref3 ? ++o : --o) {
              if (this.cp[j] > this.cp[i]) {
                s++;
              }
            }
          }
          return s % 2;
        },
        // Parity of the edges permutation. Parity of corners and edges are
        // the same if the cube is solvable.
        edgeParity: function() {
          var i, j, m, o, ref, ref1, ref2, ref3, s;
          s = 0;
          for (i = m = ref = BR, ref1 = UR + 1; ref <= ref1 ? m <= ref1 : m >= ref1; i = ref <= ref1 ? ++m : --m) {
            for (j = o = ref2 = i - 1, ref3 = UR; ref2 <= ref3 ? o <= ref3 : o >= ref3; j = ref2 <= ref3 ? ++o : --o) {
              if (this.ep[j] > this.ep[i]) {
                s++;
              }
            }
          }
          return s % 2;
        },
        // Permutation of the six corners URF, UFL, ULB, UBR, DFR, DLF
        URFtoDLF: permutationIndex("corners", URF, DLF),
        // Permutation of the three edges UR, UF, UL
        URtoUL: permutationIndex("edges", UR, UL),
        // Permutation of the three edges UB, DR, DF
        UBtoDF: permutationIndex("edges", UB, DF),
        // Permutation of the six edges UR, UF, UL, UB, DR, DF
        URtoDF: permutationIndex("edges", UR, DF),
        // Permutation of the equator slice edges FR, FL, BL and BR
        FRtoBR: permutationIndex("edges", FR, BR, true)
      };
      for (key in Include) {
        value = Include[key];
        Cube3.prototype[key] = value;
      }
      computeMoveTable = function(context, coord, size) {
        var apply, cube, i, inner, j, k, m, move, o, p, ref, results;
        apply = context === "corners" ? "cornerMultiply" : "edgeMultiply";
        cube = new Cube3();
        results = [];
        for (i = m = 0, ref = size - 1; 0 <= ref ? m <= ref : m >= ref; i = 0 <= ref ? ++m : --m) {
          cube[coord](i);
          inner = [];
          for (j = o = 0; o <= 5; j = ++o) {
            move = Cube3.moves[j];
            for (k = p = 0; p <= 2; k = ++p) {
              cube[apply](move);
              inner.push(cube[coord]());
            }
            cube[apply](move);
          }
          results.push(inner);
        }
        return results;
      };
      mergeURtoDF = function() {
        var a, b;
        a = new Cube3();
        b = new Cube3();
        return function(URtoUL, UBtoDF) {
          var i, m;
          a.URtoUL(URtoUL);
          b.UBtoDF(UBtoDF);
          for (i = m = 0; m <= 7; i = ++m) {
            if (a.ep[i] !== -1) {
              if (b.ep[i] !== -1) {
                return -1;
              } else {
                b.ep[i] = a.ep[i];
              }
            }
          }
          return b.URtoDF();
        };
      }();
      N_TWIST = 2187;
      N_FLIP = 2048;
      N_PARITY = 2;
      N_FRtoBR = 11880;
      N_SLICE1 = 495;
      N_SLICE2 = 24;
      N_URFtoDLF = 20160;
      N_URtoDF = 20160;
      N_URtoUL = 1320;
      N_UBtoDF = 1320;
      Cube3.moveTables = {
        parity: [[1, 0, 1, 1, 0, 1, 1, 0, 1, 1, 0, 1, 1, 0, 1, 1, 0, 1], [0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0]],
        twist: null,
        flip: null,
        FRtoBR: null,
        URFtoDLF: null,
        URtoDF: null,
        URtoUL: null,
        UBtoDF: null,
        mergeURtoDF: null
      };
      moveTableParams = {
        // name: [scope, size]
        twist: ["corners", N_TWIST],
        flip: ["edges", N_FLIP],
        FRtoBR: ["edges", N_FRtoBR],
        URFtoDLF: ["corners", N_URFtoDLF],
        URtoDF: ["edges", N_URtoDF],
        URtoUL: ["edges", N_URtoUL],
        UBtoDF: ["edges", N_UBtoDF],
        mergeURtoDF: []
      };
      Cube3.computeMoveTables = function(...tables) {
        var len, m, name, scope, size, tableName;
        if (tables.length === 0) {
          tables = function() {
            var results;
            results = [];
            for (name in moveTableParams) {
              results.push(name);
            }
            return results;
          }();
        }
        for (m = 0, len = tables.length; m < len; m++) {
          tableName = tables[m];
          if (this.moveTables[tableName] !== null) {
            continue;
          }
          if (tableName === "mergeURtoDF") {
            this.moveTables.mergeURtoDF = function() {
              var UBtoDF, URtoUL, o, results;
              results = [];
              for (URtoUL = o = 0; o <= 335; URtoUL = ++o) {
                results.push(function() {
                  var p, results1;
                  results1 = [];
                  for (UBtoDF = p = 0; p <= 335; UBtoDF = ++p) {
                    results1.push(mergeURtoDF(URtoUL, UBtoDF));
                  }
                  return results1;
                }());
              }
              return results;
            }();
          } else {
            [scope, size] = moveTableParams[tableName];
            this.moveTables[tableName] = computeMoveTable(scope, tableName, size);
          }
        }
        return this;
      };
      allMoves1 = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17];
      nextMoves1 = function() {
        var face, lastFace, m, next, o, p, power, results;
        results = [];
        for (lastFace = m = 0; m <= 5; lastFace = ++m) {
          next = [];
          for (face = o = 0; o <= 5; face = ++o) {
            if (face !== lastFace && face !== lastFace - 3) {
              for (power = p = 0; p <= 2; power = ++p) {
                next.push(face * 3 + power);
              }
            }
          }
          results.push(next);
        }
        return results;
      }();
      allMoves2 = [0, 1, 2, 4, 7, 9, 10, 11, 13, 16];
      nextMoves2 = function() {
        var face, lastFace, len, m, next, o, p, power, powers, results;
        results = [];
        for (lastFace = m = 0; m <= 5; lastFace = ++m) {
          next = [];
          for (face = o = 0; o <= 5; face = ++o) {
            if (!(face !== lastFace && face !== lastFace - 3)) {
              continue;
            }
            powers = face === 0 || face === 3 ? [0, 1, 2] : [1];
            for (p = 0, len = powers.length; p < len; p++) {
              power = powers[p];
              next.push(face * 3 + power);
            }
          }
          results.push(next);
        }
        return results;
      }();
      pruning = function(table, index, value2) {
        var pos, shift, slot;
        pos = index % 8;
        slot = index >> 3;
        shift = pos << 2;
        if (value2 != null) {
          table[slot] &= ~(15 << shift);
          table[slot] |= value2 << shift;
          return value2;
        } else {
          return (table[slot] & 15 << shift) >>> shift;
        }
      };
      computePruningTable = function(phase, size, currentCoords, nextIndex) {
        var current, depth, done, index, len, m, move, moves, next, o, ref, table, x;
        table = function() {
          var m2, ref2, results;
          results = [];
          for (x = m2 = 0, ref2 = Math.ceil(size / 8) - 1; 0 <= ref2 ? m2 <= ref2 : m2 >= ref2; x = 0 <= ref2 ? ++m2 : --m2) {
            results.push(4294967295);
          }
          return results;
        }();
        if (phase === 1) {
          moves = allMoves1;
        } else {
          moves = allMoves2;
        }
        depth = 0;
        pruning(table, 0, depth);
        done = 1;
        while (done !== size) {
          for (index = m = 0, ref = size - 1; 0 <= ref ? m <= ref : m >= ref; index = 0 <= ref ? ++m : --m) {
            if (!(pruning(table, index) === depth)) {
              continue;
            }
            current = currentCoords(index);
            for (o = 0, len = moves.length; o < len; o++) {
              move = moves[o];
              next = nextIndex(current, move);
              if (pruning(table, next) === 15) {
                pruning(table, next, depth + 1);
                done++;
              }
            }
          }
          depth++;
        }
        return table;
      };
      Cube3.pruningTables = {
        sliceTwist: null,
        sliceFlip: null,
        sliceURFtoDLFParity: null,
        sliceURtoDFParity: null
      };
      pruningTableParams = {
        // name: [phase, size, currentCoords, nextIndex]
        sliceTwist: [
          1,
          N_SLICE1 * N_TWIST,
          function(index) {
            return [
              index % N_SLICE1,
              index / N_SLICE1 | 0
            ];
          },
          function(current, move) {
            var newSlice, newTwist, slice, twist;
            [
              slice,
              twist
            ] = current;
            newSlice = Cube3.moveTables.FRtoBR[slice * 24][move] / 24 | 0;
            newTwist = Cube3.moveTables.twist[twist][move];
            return newTwist * N_SLICE1 + newSlice;
          }
        ],
        sliceFlip: [
          1,
          N_SLICE1 * N_FLIP,
          function(index) {
            return [
              index % N_SLICE1,
              index / N_SLICE1 | 0
            ];
          },
          function(current, move) {
            var flip, newFlip, newSlice, slice;
            [
              slice,
              flip
            ] = current;
            newSlice = Cube3.moveTables.FRtoBR[slice * 24][move] / 24 | 0;
            newFlip = Cube3.moveTables.flip[flip][move];
            return newFlip * N_SLICE1 + newSlice;
          }
        ],
        sliceURFtoDLFParity: [
          2,
          N_SLICE2 * N_URFtoDLF * N_PARITY,
          function(index) {
            return [
              index % 2,
              (index / 2 | 0) % N_SLICE2,
              (index / 2 | 0) / N_SLICE2 | 0
            ];
          },
          function(current, move) {
            var URFtoDLF, newParity, newSlice, newURFtoDLF, parity2, slice;
            [
              parity2,
              slice,
              URFtoDLF
            ] = current;
            newParity = Cube3.moveTables.parity[parity2][move];
            newSlice = Cube3.moveTables.FRtoBR[slice][move];
            newURFtoDLF = Cube3.moveTables.URFtoDLF[URFtoDLF][move];
            return (newURFtoDLF * N_SLICE2 + newSlice) * 2 + newParity;
          }
        ],
        sliceURtoDFParity: [
          2,
          N_SLICE2 * N_URtoDF * N_PARITY,
          function(index) {
            return [
              index % 2,
              (index / 2 | 0) % N_SLICE2,
              (index / 2 | 0) / N_SLICE2 | 0
            ];
          },
          function(current, move) {
            var URtoDF, newParity, newSlice, newURtoDF, parity2, slice;
            [
              parity2,
              slice,
              URtoDF
            ] = current;
            newParity = Cube3.moveTables.parity[parity2][move];
            newSlice = Cube3.moveTables.FRtoBR[slice][move];
            newURtoDF = Cube3.moveTables.URtoDF[URtoDF][move];
            return (newURtoDF * N_SLICE2 + newSlice) * 2 + newParity;
          }
        ]
      };
      Cube3.computePruningTables = function(...tables) {
        var len, m, name, params, tableName;
        if (tables.length === 0) {
          tables = function() {
            var results;
            results = [];
            for (name in pruningTableParams) {
              results.push(name);
            }
            return results;
          }();
        }
        for (m = 0, len = tables.length; m < len; m++) {
          tableName = tables[m];
          if (this.pruningTables[tableName] !== null) {
            continue;
          }
          params = pruningTableParams[tableName];
          this.pruningTables[tableName] = computePruningTable(...params);
        }
        return this;
      };
      Cube3.initSolver = function() {
        Cube3.computeMoveTables();
        return Cube3.computePruningTables();
      };
      Cube3.prototype.solveUpright = function(maxDepth = 22) {
        var State, freeStates, moveNames, phase1, phase1search, phase2, phase2search, solution, state, x;
        moveNames = function() {
          var face, faceName, m, o, power, powerName, result;
          faceName = ["U", "R", "F", "D", "L", "B"];
          powerName = ["", "2", "'"];
          result = [];
          for (face = m = 0; m <= 5; face = ++m) {
            for (power = o = 0; o <= 2; power = ++o) {
              result.push(faceName[face] + powerName[power]);
            }
          }
          return result;
        }();
        State = class State {
          constructor(cube) {
            this.parent = null;
            this.lastMove = null;
            this.depth = 0;
            if (cube) {
              this.init(cube);
            }
          }
          init(cube) {
            this.flip = cube.flip();
            this.twist = cube.twist();
            this.slice = cube.FRtoBR() / N_SLICE2 | 0;
            this.parity = cube.cornerParity();
            this.URFtoDLF = cube.URFtoDLF();
            this.FRtoBR = cube.FRtoBR();
            this.URtoUL = cube.URtoUL();
            this.UBtoDF = cube.UBtoDF();
            return this;
          }
          solution() {
            if (this.parent) {
              return this.parent.solution() + moveNames[this.lastMove] + " ";
            } else {
              return "";
            }
          }
          //# Helpers
          move(table, index, move) {
            return Cube3.moveTables[table][index][move];
          }
          pruning(table, index) {
            return pruning(Cube3.pruningTables[table], index);
          }
          //# Phase 1
          // Return the next valid phase 1 moves for this state
          moves1() {
            if (this.lastMove !== null) {
              return nextMoves1[this.lastMove / 3 | 0];
            } else {
              return allMoves1;
            }
          }
          // Compute the minimum number of moves to the end of phase 1
          minDist1() {
            var d1, d2;
            d1 = this.pruning("sliceFlip", N_SLICE1 * this.flip + this.slice);
            d2 = this.pruning("sliceTwist", N_SLICE1 * this.twist + this.slice);
            return max(d1, d2);
          }
          // Compute the next phase 1 state for the given move
          next1(move) {
            var next;
            next = freeStates.pop();
            next.parent = this;
            next.lastMove = move;
            next.depth = this.depth + 1;
            next.flip = this.move("flip", this.flip, move);
            next.twist = this.move("twist", this.twist, move);
            next.slice = this.move("FRtoBR", this.slice * 24, move) / 24 | 0;
            return next;
          }
          //# Phase 2
          // Return the next valid phase 2 moves for this state
          moves2() {
            if (this.lastMove !== null) {
              return nextMoves2[this.lastMove / 3 | 0];
            } else {
              return allMoves2;
            }
          }
          // Compute the minimum number of moves to the solved cube
          minDist2() {
            var d1, d2, index1, index2;
            index1 = (N_SLICE2 * this.URtoDF + this.FRtoBR) * N_PARITY + this.parity;
            d1 = this.pruning("sliceURtoDFParity", index1);
            index2 = (N_SLICE2 * this.URFtoDLF + this.FRtoBR) * N_PARITY + this.parity;
            d2 = this.pruning("sliceURFtoDLFParity", index2);
            return max(d1, d2);
          }
          // Initialize phase 2 coordinates
          init2(top = true) {
            if (this.parent === null) {
              return;
            }
            this.parent.init2(false);
            this.URFtoDLF = this.move("URFtoDLF", this.parent.URFtoDLF, this.lastMove);
            this.FRtoBR = this.move("FRtoBR", this.parent.FRtoBR, this.lastMove);
            this.parity = this.move("parity", this.parent.parity, this.lastMove);
            this.URtoUL = this.move("URtoUL", this.parent.URtoUL, this.lastMove);
            this.UBtoDF = this.move("UBtoDF", this.parent.UBtoDF, this.lastMove);
            if (top) {
              return this.URtoDF = this.move("mergeURtoDF", this.URtoUL, this.UBtoDF);
            }
          }
          // Compute the next phase 2 state for the given move
          next2(move) {
            var next;
            next = freeStates.pop();
            next.parent = this;
            next.lastMove = move;
            next.depth = this.depth + 1;
            next.URFtoDLF = this.move("URFtoDLF", this.URFtoDLF, move);
            next.FRtoBR = this.move("FRtoBR", this.FRtoBR, move);
            next.parity = this.move("parity", this.parity, move);
            next.URtoDF = this.move("URtoDF", this.URtoDF, move);
            return next;
          }
        };
        solution = null;
        phase1search = function(state2) {
          var depth, m, ref, results;
          depth = 0;
          results = [];
          for (depth = m = 1, ref = maxDepth; 1 <= ref ? m <= ref : m >= ref; depth = 1 <= ref ? ++m : --m) {
            phase1(state2, depth);
            if (solution !== null) {
              break;
            }
            results.push(depth++);
          }
          return results;
        };
        phase1 = function(state2, depth) {
          var len, m, move, next, ref, ref1, results;
          if (depth === 0) {
            if (state2.minDist1() === 0) {
              if (state2.lastMove === null || (ref = state2.lastMove, indexOf.call(allMoves2, ref) < 0)) {
                return phase2search(state2);
              }
            }
          } else if (depth > 0) {
            if (state2.minDist1() <= depth) {
              ref1 = state2.moves1();
              results = [];
              for (m = 0, len = ref1.length; m < len; m++) {
                move = ref1[m];
                next = state2.next1(move);
                phase1(next, depth - 1);
                freeStates.push(next);
                if (solution !== null) {
                  break;
                } else {
                  results.push(void 0);
                }
              }
              return results;
            }
          }
        };
        phase2search = function(state2) {
          var depth, m, ref, results;
          state2.init2();
          results = [];
          for (depth = m = 1, ref = maxDepth - state2.depth; 1 <= ref ? m <= ref : m >= ref; depth = 1 <= ref ? ++m : --m) {
            phase2(state2, depth);
            if (solution !== null) {
              break;
            }
            results.push(depth++);
          }
          return results;
        };
        phase2 = function(state2, depth) {
          var len, m, move, next, ref, results;
          if (depth === 0) {
            if (state2.minDist2() === 0) {
              return solution = state2.solution();
            }
          } else if (depth > 0) {
            if (state2.minDist2() <= depth) {
              ref = state2.moves2();
              results = [];
              for (m = 0, len = ref.length; m < len; m++) {
                move = ref[m];
                next = state2.next2(move);
                phase2(next, depth - 1);
                freeStates.push(next);
                if (solution !== null) {
                  break;
                } else {
                  results.push(void 0);
                }
              }
              return results;
            }
          }
        };
        freeStates = function() {
          var m, ref, results;
          results = [];
          for (x = m = 0, ref = maxDepth + 1; 0 <= ref ? m <= ref : m >= ref; x = 0 <= ref ? ++m : --m) {
            results.push(new State());
          }
          return results;
        }();
        state = freeStates.pop().init(this);
        phase1search(state);
        freeStates.push(state);
        if (solution.length > 0) {
          solution = solution.substring(0, solution.length - 1);
        }
        return solution;
      };
      faceNums = {
        U: 0,
        R: 1,
        F: 2,
        D: 3,
        L: 4,
        B: 5
      };
      faceNames = {
        0: "U",
        1: "R",
        2: "F",
        3: "D",
        4: "L",
        5: "B"
      };
      Cube3.prototype.solve = function(maxDepth = 22) {
        var clone, len, m, move, ref, rotation, solution, upright, uprightSolution;
        clone = this.clone();
        upright = clone.upright();
        clone.move(upright);
        rotation = new Cube3().move(upright).center;
        uprightSolution = clone.solveUpright(maxDepth);
        solution = [];
        ref = uprightSolution.split(" ");
        for (m = 0, len = ref.length; m < len; m++) {
          move = ref[m];
          solution.push(faceNames[rotation[faceNums[move[0]]]]);
          if (move.length > 1) {
            solution[solution.length - 1] += move[1];
          }
        }
        return solution.join(" ");
      };
      Cube3.scramble = function() {
        return Cube3.inverse(Cube3.random().solve());
      };
    }).call(exports);
  }
});

// ../../node_modules/.pnpm/cubejs@1.3.2/node_modules/cubejs/index.js
var require_cubejs = __commonJS({
  "../../node_modules/.pnpm/cubejs@1.3.2/node_modules/cubejs/index.js"(exports, module) {
    module.exports = require_cube();
    require_solve();
  }
});

// src/ai-assemble.ts
var import_cubejs2 = __toESM(require_cubejs(), 1);

// src/types.ts
var FACES = ["U", "R", "F", "D", "L", "B"];

// src/facelet-cube.ts
var SOLVED = "UUUUUUUUURRRRRRRRRFFFFFFFFFDDDDDDDDDLLLLLLLLLBBBBBBBBB";
var CORNER_FACELET = [
  [8, 9, 20],
  [6, 18, 38],
  [0, 36, 47],
  [2, 45, 11],
  [29, 26, 15],
  [27, 44, 24],
  [33, 53, 42],
  [35, 17, 51]
];
var EDGE_FACELET = [
  [5, 10],
  [7, 19],
  [3, 37],
  [1, 46],
  [32, 16],
  [28, 25],
  [30, 43],
  [34, 52],
  [23, 12],
  [21, 41],
  [50, 39],
  [48, 14]
];
var CORNER_COLOR = CORNER_FACELET.map(
  (t) => t.map((i) => SOLVED[i])
);
var EDGE_COLOR = EDGE_FACELET.map((t) => t.map((i) => SOLVED[i]));
var ROT90 = [6, 3, 0, 7, 4, 1, 8, 5, 2];
function rotateFace(a, k) {
  let out = a;
  for (let t = 0; t < (k % 4 + 4) % 4; t++) out = ROT90.map((i) => out[i]);
  return out;
}
var SIDE_OF_POSITION = {
  1: "top",
  5: "right",
  7: "bottom",
  3: "left"
};
var FACE_NEIGHBOURS = (() => {
  const out = {};
  for (const f of FACES) out[f] = {};
  for (const pair of EDGE_FACELET) {
    const [a, b] = [pair[0], pair[1]];
    for (const [from, to] of [
      [a, b],
      [b, a]
    ]) {
      const side = SIDE_OF_POSITION[from % 9];
      if (side !== void 0) out[FACES[Math.floor(from / 9)]][side] = FACES[Math.floor(to / 9)];
    }
  }
  return out;
})();
var CENTER_INDEX = {
  U: 4,
  R: 13,
  F: 22,
  D: 31,
  L: 40,
  B: 49
};
function decodeFacelets(f) {
  if (f.length !== 54) return null;
  const cp = new Array(8);
  const co = new Array(8);
  for (let i = 0; i < 8; i++) {
    const slot = CORNER_FACELET[i];
    let ori = 0;
    for (; ori < 3; ori++) {
      const c = f[slot[ori]];
      if (c === "U" || c === "D") break;
    }
    if (ori === 3) return null;
    const c0 = f[slot[ori]];
    const c1 = f[slot[(ori + 1) % 3]];
    const c2 = f[slot[(ori + 2) % 3]];
    let found = -1;
    for (let j = 0; j < 8; j++) {
      const cc = CORNER_COLOR[j];
      if (c0 === cc[0] && c1 === cc[1] && c2 === cc[2]) {
        found = j;
        break;
      }
    }
    if (found < 0) return null;
    cp[i] = found;
    co[i] = ori;
  }
  const ep = new Array(12);
  const eo = new Array(12);
  for (let i = 0; i < 12; i++) {
    const slot = EDGE_FACELET[i];
    const a = f[slot[0]];
    const b = f[slot[1]];
    let found = -1;
    let ori = 0;
    for (let j = 0; j < 12; j++) {
      const ec = EDGE_COLOR[j];
      if (a === ec[0] && b === ec[1]) {
        found = j;
        ori = 0;
        break;
      }
      if (a === ec[1] && b === ec[0]) {
        found = j;
        ori = 1;
        break;
      }
    }
    if (found < 0) return null;
    ep[i] = found;
    eo[i] = ori;
  }
  return { cp, co, ep, eo };
}
function isPermutation(a, n) {
  if (a.length !== n) return false;
  const seen = new Array(n).fill(false);
  for (const v of a) {
    if (!Number.isInteger(v) || v < 0 || v >= n || seen[v]) return false;
    seen[v] = true;
  }
  return true;
}
function inDomain(a, n, max) {
  if (a.length !== n) return false;
  for (const v of a) {
    if (!Number.isInteger(v) || v < 0 || v > max) return false;
  }
  return true;
}
function parity(a) {
  let inversions = 0;
  for (let i = 0; i < a.length; i++) {
    for (let j = i + 1; j < a.length; j++) {
      if (a[i] > a[j]) inversions++;
    }
  }
  return inversions & 1;
}
function isSolvable(s) {
  if (!isPermutation(s.cp, 8) || !isPermutation(s.ep, 12)) return false;
  if (!inDomain(s.co, 8, 2) || !inDomain(s.eo, 12, 1)) return false;
  const coSum = s.co.reduce((sum, v) => sum + v, 0);
  const eoSum = s.eo.reduce((sum, v) => sum + v, 0);
  if (coSum % 3 !== 0) return false;
  if (eoSum % 2 !== 0) return false;
  return parity(s.cp) === parity(s.ep);
}
function centersOk(f) {
  return f.length === 54 && f[CENTER_INDEX.U] === "U" && f[CENTER_INDEX.R] === "R" && f[CENTER_INDEX.F] === "F" && f[CENTER_INDEX.D] === "D" && f[CENTER_INDEX.L] === "L" && f[CENTER_INDEX.B] === "B";
}
function isStructurallyValid(f) {
  if (!centersOk(f)) return false;
  const state = decodeFacelets(f);
  return state !== null && isSolvable(state);
}

// src/misread-decode.ts
var import_cubejs = __toESM(require_cubejs(), 1);
function whole(name, value, fallback) {
  if (value === void 0) return fallback;
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`decodeMisread: ${name} must be a non-negative integer, got ${value}`);
  }
  return value;
}
var CORNER_ORI = 3;
var EDGE_ORI = 2;
var DEFAULT_MAX_DISTANCE = 4;
var DEFAULT_NODE_BUDGET = 2e7;
var SHOWN_INDEX = [0, 1, 2, 3].map(
  (k) => rotateFace([0, 1, 2, 3, 4, 5, 6, 7, 8], k)
);
function letterIndex(letter) {
  const i = FACES.indexOf(letter);
  if (i < 0) throw new Error(`not a face letter: ${letter}`);
  return i;
}
function canonicalColors(faceCentre) {
  return {
    corner: CORNER_COLOR.map((t) => t.map((l) => faceCentre[letterIndex(l)])),
    edge: EDGE_COLOR.map((t) => t.map((l) => faceCentre[letterIndex(l)]))
  };
}
function pieceTensor(colors54, facelet, canon, orientations) {
  const stickers = orientations;
  return facelet.map((slot) => {
    const observed = slot.map((x) => colors54[x]);
    return canon.map((cubie) => {
      const row = [];
      for (let r = 0; r < orientations; r++) {
        let d = 0;
        for (let t = 0; t < stickers; t++) if (observed[t] !== cubie[(t + r) % stickers]) d++;
        row.push(d);
      }
      return row;
    });
  });
}
function buildTensors(colors54, canon) {
  return {
    corner: pieceTensor(colors54, CORNER_FACELET, canon.corner, CORNER_ORI),
    edge: pieceTensor(colors54, EDGE_FACELET, canon.edge, EDGE_ORI),
    cornerColors: canon.corner,
    edgeColors: canon.edge
  };
}
function lowerBound(t) {
  let lb = 0;
  for (const slot of t.corner) {
    let best = 3;
    for (const ori of slot) for (const d of ori) if (d < best) best = d;
    lb += best;
  }
  for (const slot of t.edge) {
    let best = 2;
    for (const ori of slot) for (const d of ori) if (d < best) best = d;
    lb += best;
  }
  return lb;
}
function assignments(tensor, n, budget, counter) {
  const rowMin = [];
  for (const slot of tensor) {
    let best = Number.POSITIVE_INFINITY;
    for (const ori2 of slot) for (const d of ori2) if (d < best) best = d;
    rowMin.push(best);
  }
  const suffix = new Array(n + 1).fill(0);
  for (let i = n - 1; i >= 0; i--) suffix[i] = suffix[i + 1] + rowMin[i];
  const out = [];
  const used = new Array(n).fill(false);
  const cubie = new Array(n);
  const ori = new Array(n);
  let exhausted = false;
  const walk = (i, acc) => {
    if (exhausted) return;
    if (++counter.nodes > counter.limit) {
      exhausted = true;
      return;
    }
    if (acc + suffix[i] > budget) return;
    if (i === n) {
      out.push({ cubie: [...cubie], ori: [...ori], total: acc });
      return;
    }
    for (let j = 0; j < n; j++) {
      if (used[j]) continue;
      const orientations = tensor[i][j];
      for (let r = 0; r < orientations.length; r++) {
        const next = acc + orientations[r];
        if (next + suffix[i + 1] > budget) continue;
        used[j] = true;
        cubie[i] = j;
        ori[i] = r;
        walk(i + 1, next);
        used[j] = false;
        if (exhausted) return;
      }
    }
  };
  walk(0, 0);
  return exhausted ? null : out;
}
function realise(t, corners, edges, base) {
  const out = [...base];
  for (let i = 0; i < 8; i++) {
    const colours = t.cornerColors[corners.cubie[i]];
    for (let p = 0; p < 3; p++) out[CORNER_FACELET[i][p]] = colours[(p + corners.ori[i]) % 3];
  }
  for (let i = 0; i < 12; i++) {
    const colours = t.edgeColors[edges.cubie[i]];
    for (let p = 0; p < 2; p++) out[EDGE_FACELET[i][p]] = colours[(p + edges.ori[i]) % 2];
  }
  return out;
}
function isLegal(colors54, centreOwner) {
  let s = "";
  for (const c of colors54) {
    const owner = centreOwner.get(c);
    if (owner === void 0) return false;
    s += owner;
  }
  if (!isStructurallyValid(s)) return false;
  try {
    return import_cubejs.default.fromString(s).asString() === s;
  } catch {
    return false;
  }
}
function flatten(faces, rotations) {
  const out = [];
  for (let fi = 0; fi < 6; fi++) {
    for (const c of rotateFace(faces[FACES[fi]].colors, rotations[fi])) out.push(c);
  }
  return out;
}
function decodeMisread(faces, centreOwner, options = {}) {
  const maxDistance = whole("maxDistance", options.maxDistance, DEFAULT_MAX_DISTANCE);
  const counter = { nodes: 0, limit: whole("nodeBudget", options.nodeBudget, DEFAULT_NODE_BUDGET) };
  const faceCentre = FACES.map((f) => faces[f].colors[4]);
  const canon = canonicalColors(faceCentre);
  const candidates = [];
  const combos = options.fixedRotation ? 1 : 4096;
  for (let combo = 0; combo < combos; combo++) {
    const rotations = [0, 1, 2, 3, 4, 5].map((i) => combo >> 2 * i & 3);
    const bound = lowerBound(buildTensors(flatten(faces, rotations), canon));
    if (bound <= maxDistance) candidates.push({ rotations, bound });
  }
  for (let budget = 0; budget <= maxDistance; budget++) {
    const found = [];
    for (const { rotations, bound } of candidates) {
      if (bound > budget) continue;
      const observed = flatten(faces, rotations);
      const tensors = buildTensors(observed, canon);
      const corners = assignments(tensors.corner, 8, budget, counter);
      if (corners === null) return { kind: "unknown" };
      const edges = assignments(tensors.edge, 12, budget, counter);
      if (edges === null) return { kind: "unknown" };
      for (const c of corners) {
        for (const e of edges) {
          if (++counter.nodes > counter.limit) return { kind: "unknown" };
          if (c.total + e.total !== budget) continue;
          const repaired = realise(tensors, c, e, observed);
          if (isLegal(repaired, centreOwner)) found.push({ rotations, observed, repaired });
        }
      }
    }
    if (found.length === 0) continue;
    const stickers = /* @__PURE__ */ new Map();
    const shapes = /* @__PURE__ */ new Set();
    for (const { rotations, observed, repaired } of found) {
      shapes.add(repaired.join(","));
      for (let p = 0; p < 54; p++) {
        if (repaired[p] === observed[p]) continue;
        const fi = Math.floor(p / 9);
        const index = SHOWN_INDEX[rotations[fi]][p % 9];
        stickers.set(`${fi}:${index}`, { face: FACES[fi], index, to: repaired[p] });
      }
    }
    return {
      kind: "repair",
      distance: budget,
      stickers: [...stickers.values()],
      unique: shapes.size === 1
    };
  }
  return { kind: "beyond", distance: maxDistance };
}

// src/ai-assemble.ts
var TOP_NEIGHBOUR = {
  U: "B",
  R: "U",
  F: "U",
  D: "F",
  L: "U",
  B: "U"
};
var CONFIRM_TOLERANCE = 2;
function cubejsRoundTrips(facelets) {
  try {
    return import_cubejs2.default.fromString(facelets).asString() === facelets;
  } catch {
    return false;
  }
}
function reject(reason, extra = {}) {
  return {
    facelets: "",
    valid: false,
    confidence: 0,
    lowConfidence: [...Array(54).keys()],
    reason,
    ...extra
  };
}
function matchingRotations(original, confirmed) {
  if (original.colors[4] !== confirmed.colors[4]) return /* @__PURE__ */ new Set();
  const dist = [0, 1, 2, 3].map(
    (k) => rotateFace(original.colors, k).reduce((s, c, i) => s + (c === confirmed.colors[i] ? 0 : 1), 0)
  );
  return new Set([0, 1, 2, 3].filter((k) => dist[k] <= CONFIRM_TOLERANCE));
}
function pickConfirm(candidates, confirmed) {
  const useful = FACES.filter((face2, fi) => {
    if (confirmed[face2]) return false;
    const perCandidate = candidates.map(
      ([, combos]) => [...new Set(combos.map((c) => c[fi]))].sort().join(",")
    );
    return new Set(perCandidate).size > 1;
  });
  const face = useful.find((f) => TOP_NEIGHBOUR[f] === "U") ?? useful[0];
  return face === void 0 ? void 0 : { face, up: TOP_NEIGHBOUR[face] };
}
function pickVerification(survivorCombos, weak, confirmed) {
  let best;
  let bestScore = 0;
  FACES.forEach((face, fi) => {
    if (confirmed[face]) return;
    const ours = new Set(survivorCombos.map((c) => c[fi]));
    const score = weak.filter(([, combos]) => combos.every((c) => !ours.has(c[fi]))).length + (TOP_NEIGHBOUR[face] === "U" ? 0.5 : 0);
    if (score > bestScore) {
      bestScore = score;
      best = face;
    }
  });
  return best === void 0 || bestScore < 1 ? void 0 : { face: best, up: TOP_NEIGHBOUR[best] };
}
function solvableReadings(faces, centreOwner) {
  const buildFacelets = (rots2) => {
    const letters = [];
    for (let fi = 0; fi < 6; fi++) {
      const rc = rotateFace(faces[FACES[fi]].colors, rots2[fi]);
      for (let i = 0; i < 9; i++) {
        const owner = centreOwner.get(rc[i]);
        if (owner === void 0) return null;
        letters.push(owner);
      }
    }
    return letters.join("");
  };
  const seen = /* @__PURE__ */ new Map();
  const rots = [0, 0, 0, 0, 0, 0];
  for (let n = 0; n < 4096; n++) {
    for (let i = 0; i < 6; i++) rots[i] = n >> 2 * i & 3;
    const fl = buildFacelets(rots);
    if (fl === null) continue;
    let combos = seen.get(fl);
    if (combos === void 0) {
      combos = isStructurallyValid(fl) && cubejsRoundTrips(fl) ? [] : null;
      seen.set(fl, combos);
    }
    if (combos !== null) combos.push([...rots]);
  }
  return [...seen].filter((e) => e[1] !== null);
}
function diagnose(faces, centreOwner, options = {}) {
  const decoded = decodeMisread(faces, centreOwner, options);
  if (decoded.kind === "unknown") return {};
  if (decoded.kind === "beyond") return { misreadCount: decoded.distance + 1 };
  const pointable = decoded.distance === 1 && decoded.unique && decoded.stickers.length === 1;
  const suspects = pointable ? decoded.stickers.map((s) => ({ face: s.face, index: s.index, to: s.to })) : [];
  const blamed = new Set(decoded.stickers.map((s) => s.face));
  return {
    misreadCount: decoded.distance,
    ...suspects.length > 0 ? { suspects } : {},
    ...blamed.size === 1 ? { misreadFace: [...blamed][0] } : {}
  };
}
function buildCentreOwner(faces) {
  const centreOwner = /* @__PURE__ */ new Map();
  for (const face of FACES) {
    const f = faces[face];
    if (!f || f.colors.length !== 9 || f.confidence.length !== 9) {
      throw new Error(`face ${face}: expected 9 colours + 9 confidences`);
    }
    for (const c of f.confidence) {
      if (!Number.isFinite(c) || c < 0 || c > 1) {
        throw new Error(`face ${face}: confidence ${c} is not a number in [0, 1]`);
      }
    }
    const centre = f.colors[4];
    if (centreOwner.has(centre)) return reject(`two faces share centre colour ${centre}`);
    centreOwner.set(centre, face);
  }
  return centreOwner;
}
function summariseConfidence(conf, threshold) {
  let min = 1;
  const lowConfidence = [];
  conf.forEach((c, i) => {
    if (c < min) min = c;
    if (c < threshold) lowConfidence.push(i);
  });
  return { confidence: min, lowConfidence };
}
function assemblePainted(faces, threshold = 0.15) {
  const centreOwner = buildCentreOwner(faces);
  if (!(centreOwner instanceof Map)) return centreOwner;
  const letters = [];
  for (const face of FACES) {
    for (const colour of faces[face].colors) {
      const owner = centreOwner.get(colour);
      if (owner === void 0) return reject("a sticker is not one of the six centre colours");
      letters.push(owner);
    }
  }
  const facelets = letters.join("");
  if (!isStructurallyValid(facelets) || !cubejsRoundTrips(facelets)) {
    return reject("not a solvable cube yet", diagnose(faces, centreOwner, { fixedRotation: true }));
  }
  const conf = FACES.flatMap((f) => faces[f].confidence);
  return { facelets, valid: true, ...summariseConfidence(conf, threshold) };
}
function assembleColors(faces, threshold = 0.15, confirmed = {}) {
  const centreOwner = buildCentreOwner(faces);
  if (!(centreOwner instanceof Map)) return centreOwner;
  const all = solvableReadings(faces, centreOwner);
  if (all.length === 0) {
    return reject(
      "no orientation of the faces is solvable \u2014 a colour was misread",
      diagnose(faces, centreOwner)
    );
  }
  const confirmedFaces = FACES.filter((f) => confirmed[f]);
  const allowed = /* @__PURE__ */ new Map();
  for (const face of confirmedFaces) {
    const rots = matchingRotations(faces[face], confirmed[face]);
    if (rots.size === 0) {
      return reject("that side read differently this time \u2014 checking again with the fresh read", {
        reread: face,
        confirm: { face, up: TOP_NEIGHBOUR[face] }
      });
    }
    allowed.set(face, rots);
  }
  const candidates = all.map(([fl, combos2]) => [
    fl,
    combos2.filter(
      (c) => confirmedFaces.every((face) => allowed.get(face).has(c[FACES.indexOf(face)]))
    )
  ]).filter(([, combos2]) => combos2.length > 0);
  if (candidates.length === 0) {
    const last = confirmedFaces[confirmedFaces.length - 1];
    return reject("those two looks disagree \u2014 one was held the wrong way up; try again", {
      mismatch: true,
      confirm: { face: last, up: TOP_NEIGHBOUR[last] }
    });
  }
  if (candidates.length > 1) {
    const confirm = pickConfirm(candidates, confirmed);
    if (confirm) {
      return reject(`${candidates.length} readings fit \u2014 another look narrows them`, {
        ambiguous: true,
        confirm
      });
    }
    return reject(
      "this cube is too symmetric to read for certain \u2014 turn any one face, then scan again",
      { ambiguous: true }
    );
  }
  const [facelets, combos] = candidates[0];
  const contradictions = (candidate) => confirmedFaces.filter((face) => {
    const fi = FACES.indexOf(face);
    return candidate.every((c) => !allowed.get(face).has(c[fi]));
  }).length;
  const weak = all.filter(([fl, c]) => fl !== facelets && contradictions(c) < 2);
  if (weak.length > 0) {
    const check = pickVerification(all.find(([fl]) => fl === facelets)[1], weak, confirmed);
    if (check) {
      return reject("one more look to be sure \u2014 a single look could be held wrong", {
        confirm: check
      });
    }
    return reject(
      "this cube is too symmetric to read for certain \u2014 turn any one face, then scan again",
      { ambiguous: true }
    );
  }
  const chosen = combos[0];
  const conf = [];
  for (let fi = 0; fi < 6; fi++) {
    for (const c of rotateFace(faces[FACES[fi]].confidence, chosen[fi])) conf.push(c);
  }
  return {
    facelets,
    valid: true,
    ...summariseConfidence(conf, threshold),
    rotations: [...chosen]
  };
}

// src/onnx-postprocess.ts
function decodeDetections(data, numClasses, numAnchors, confThreshold = 0.25) {
  const rows = 4 + numClasses;
  if (data.length < rows * numAnchors) {
    throw new Error(`output too small: ${data.length} < ${rows * numAnchors}`);
  }
  const at = (r, a) => data[r * numAnchors + a];
  const out = [];
  for (let a = 0; a < numAnchors; a++) {
    let best = 0;
    let bestScore = at(4, a);
    for (let c = 1; c < numClasses; c++) {
      const s = at(4 + c, a);
      if (s > bestScore) {
        bestScore = s;
        best = c;
      }
    }
    if (bestScore >= confThreshold) {
      out.push({
        cx: at(0, a),
        cy: at(1, a),
        w: at(2, a),
        h: at(3, a),
        classId: best,
        confidence: bestScore
      });
    }
  }
  return out;
}
function iou(a, b) {
  const ax0 = a.cx - a.w / 2;
  const ay0 = a.cy - a.h / 2;
  const bx0 = b.cx - b.w / 2;
  const by0 = b.cy - b.h / 2;
  const ix0 = Math.max(ax0, bx0);
  const iy0 = Math.max(ay0, by0);
  const ix1 = Math.min(ax0 + a.w, bx0 + b.w);
  const iy1 = Math.min(ay0 + a.h, by0 + b.h);
  const iw = Math.max(0, ix1 - ix0);
  const ih = Math.max(0, iy1 - iy0);
  const inter = iw * ih;
  const union = a.w * a.h + b.w * b.h - inter;
  return union <= 0 ? 0 : inter / union;
}
function nms(dets, iouThreshold = 0.45) {
  const order = [...dets].sort((a, b) => b.confidence - a.confidence);
  const kept = [];
  for (const d of order) {
    if (kept.every((k) => iou(k, d) < iouThreshold)) kept.push(d);
  }
  return kept;
}
function toGrid(nine) {
  const byY = [...nine].sort((a, b) => a.cy - b.cy);
  const rows = [byY.slice(0, 3), byY.slice(3, 6), byY.slice(6, 9)].map(
    (r) => r.sort((a, b) => a.cx - b.cx)
  );
  const size = nine.reduce((s, d) => s + (d.w + d.h) / 2, 0) / 9;
  for (const row of rows) {
    if (Math.max(...row.map((d) => d.cy)) - Math.min(...row.map((d) => d.cy)) > size) return null;
  }
  const rowY = rows.map((r) => r.reduce((s, d) => s + d.cy, 0) / 3);
  const colX = [0, 1, 2].map((c) => rows.reduce((s, r) => s + r[c].cx, 0) / 3);
  if (rowY[1] - rowY[0] < size * 0.4 || rowY[2] - rowY[1] < size * 0.4) return null;
  if (colX[1] - colX[0] < size * 0.4 || colX[2] - colX[1] < size * 0.4) return null;
  return rows.flat();
}
function fitFace(dets, minConf = 0.25) {
  const good = dets.filter((d) => d.confidence >= minConf && d.classId >= 0 && d.classId < 6);
  if (good.length === 0) return { ok: false, reason: "NO_FACE" };
  if (good.length < 9) return { ok: false, reason: "PARTIAL_FACE" };
  const nine = [...good].sort((a, b) => b.w * b.h - a.w * a.h).slice(0, 9);
  const grid = toGrid(nine);
  if (!grid) return { ok: false, reason: "BAD_GEOMETRY" };
  return {
    ok: true,
    face: { colors: grid.map((d) => d.classId), confidence: grid.map((d) => d.confidence) }
  };
}

// src/onnx-detect.ts
var IMG_SIZE = 640;
var PAD = 114 / 255;
function preprocess(frame, imgsz = IMG_SIZE) {
  const { data: src, width: w, height: h } = frame;
  const scale = imgsz / Math.max(w, h);
  const newW = Math.max(1, Math.round(w * scale));
  const newH = Math.max(1, Math.round(h * scale));
  const padX = Math.floor((imgsz - newW) / 2);
  const padY = Math.floor((imgsz - newH) / 2);
  const plane = imgsz * imgsz;
  const out = new Float32Array(3 * plane).fill(PAD);
  for (let y = 0; y < newH; y++) {
    const sy = Math.min(h - 1, Math.max(0, (y + 0.5) / scale - 0.5));
    const y0 = Math.floor(sy);
    const y1 = Math.min(h - 1, y0 + 1);
    const fy = sy - y0;
    const oy = y + padY;
    for (let x = 0; x < newW; x++) {
      const sx = Math.min(w - 1, Math.max(0, (x + 0.5) / scale - 0.5));
      const x0 = Math.floor(sx);
      const x1 = Math.min(w - 1, x0 + 1);
      const fx = sx - x0;
      const o = oy * imgsz + (x + padX);
      for (let ch = 0; ch < 3; ch++) {
        const p00 = src[(y0 * w + x0) * 4 + ch];
        const p01 = src[(y0 * w + x1) * 4 + ch];
        const p10 = src[(y1 * w + x0) * 4 + ch];
        const p11 = src[(y1 * w + x1) * 4 + ch];
        const top = p00 + (p01 - p00) * fx;
        const bot = p10 + (p11 - p10) * fx;
        out[ch * plane + o] = (top + (bot - top) * fy) / 255;
      }
    }
  }
  return { data: out, imgsz };
}
function fitFromOutput(output, opts = {}) {
  const { numClasses = 6, confThreshold = 0.25, iouThreshold = 0.45, minConf = 0.25 } = opts;
  const dets = nms(
    decodeDetections(output.data, numClasses, output.anchors, confThreshold),
    iouThreshold
  );
  return fitFace(dets, minConf);
}

// view/native-detector.ts
var CUBE_VISION = "plugin:cube-vision|";
var P = CUBE_VISION;
var NativeDetector = class {
  /**
   * @param invoke        the Tauri `invoke` (from `window.__TAURI__.core`). This is the ONLY thing
   *                      required to select the native path — the model is resolved by the plugin
   *                      itself (Rust `resolve_model_path`), not here, because the JS `path` API is
   *                      not always exposed or permitted and depending on it silently dropped the
   *                      whole app to the wasm runtime.
   * @param computeUnits  CoreML compute units; `All` lets CoreML schedule across ANE/GPU/CPU, which
   *                      the compute-unit bench found fastest and fully ANE-resident for this model.
   */
  constructor(invoke, computeUnits = 0 /* All */) {
    this.invoke = invoke;
    this.computeUnits = computeUnits;
  }
  dev = null;
  loaded = false;
  /** Bumped by `stop()`, so an open still crossing the bridge knows it has been cancelled. */
  opening = 0;
  get device() {
    return this.dev;
  }
  /**
   * Open a camera, and abandon the attempt if `stop()` lands while it is still crossing the bridge.
   *
   * The cancellation is not decoration: `Detector.use` DOCUMENTS that a `stop()` while it is
   * pending releases the camera and rejects, and `WebDetector` has always honoured it through an
   * AbortController, so callers were written against a contract only one implementation kept. This
   * one used to resume after a `stop()` and set `dev` again — reopening a camera the caller had
   * released, which on the panel's painting path meant the lens stayed on while the app reported
   * no camera at all.
   *
   * A counter rather than an AbortController, because there is nothing to abort: the plugin call
   * is already gone. What can be done is refuse to INSTALL its result, and close the camera it
   * opened behind us, which is what `close_camera` here is for.
   */
  async use(opts = {}) {
    const attempt = ++this.opening;
    const cancelled = () => attempt !== this.opening;
    const abort = () => {
      void this.invoke(`${P}close_camera`).catch(() => {
      });
      throw new DOMException("camera open superseded", "AbortError");
    };
    await this.invoke(`${P}open_camera`, { deviceId: opts.deviceId ?? null });
    if (cancelled()) abort();
    const info = await this.invoke(`${P}current_camera`);
    if (cancelled()) abort();
    this.dev = info ?? { deviceId: opts.deviceId ?? "", label: "Camera" };
  }
  async load() {
    if (this.loaded) return;
    await this.invoke(`${P}load_model`, { computeUnits: this.computeUnits });
    this.loaded = true;
  }
  async next() {
    const reply = await this.invoke(`${P}next_detection`);
    return decodeTensorResponse(reply instanceof ArrayBuffer ? reply : reply?.tensor ?? "");
  }
  async cameras() {
    return await this.invoke(`${P}list_cameras`);
  }
  stop() {
    this.opening++;
    this.dev = null;
    void this.invoke(`${P}close_camera`).catch(() => {
    });
  }
};
function base64ToBuffer(b64) {
  if (b64.length === 0) return null;
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}
function decodeTensorResponse(input) {
  const buf = typeof input === "string" ? base64ToBuffer(input) : input;
  if (buf === null || buf.byteLength < 8) return null;
  const header = new Int32Array(buf, 0, 2);
  const rows = header[0];
  const anchors = header[1];
  if (anchors <= 0 || rows <= 0) return null;
  const count = rows * anchors;
  if (buf.byteLength < 8 + count * 4) {
    throw new Error(
      `cube-vision tensor is ${buf.byteLength} bytes, need ${8 + count * 4} for ${rows}\xD7${anchors}`
    );
  }
  const data = new Float32Array(buf, 8, count);
  return { data, anchors };
}

// src/camera.ts
async function listCameras() {
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices.filter((d) => d.kind === "videoinput").map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Camera ${i + 1}` }));
}
function raceAbort(promise, signal) {
  if (!signal) return promise;
  return new Promise((resolve, reject2) => {
    if (signal.aborted) {
      reject2(abortError());
      return;
    }
    const onAbort = () => reject2(abortError());
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (err) => {
        signal.removeEventListener("abort", onAbort);
        reject2(err);
      }
    );
  });
}
var abortError = () => new DOMException("camera open aborted", "AbortError");
async function openCamera(video, opts = {}, signal) {
  if (signal?.aborted) throw abortError();
  const videoConstraints = {};
  if (opts.deviceId) videoConstraints.deviceId = { exact: opts.deviceId };
  else if (opts.facingMode) videoConstraints.facingMode = opts.facingMode;
  if (opts.width) videoConstraints.width = { ideal: opts.width };
  if (opts.height) videoConstraints.height = { ideal: opts.height };
  const stream = await navigator.mediaDevices.getUserMedia({
    video: videoConstraints,
    audio: false
  });
  const release = () => {
    for (const track of stream.getTracks()) track.stop();
    if (video.srcObject === stream) video.srcObject = null;
  };
  const throwIfAborted = () => {
    if (signal?.aborted) throw abortError();
  };
  try {
    throwIfAborted();
    video.srcObject = stream;
    await raceAbort(video.play(), signal);
    throwIfAborted();
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("2D canvas context unavailable");
    const track = stream.getVideoTracks()[0];
    const device = {
      deviceId: track?.getSettings().deviceId ?? "",
      label: track?.label || "Camera"
    };
    return {
      device,
      grab() {
        const w = video.videoWidth;
        const h = video.videoHeight;
        if (w === 0 || h === 0) throw new Error("camera not ready: video has no dimensions yet");
        canvas.width = w;
        canvas.height = h;
        ctx.drawImage(video, 0, 0, w, h);
        const img = ctx.getImageData(0, 0, w, h);
        return { data: img.data, width: img.width, height: img.height };
      },
      stop: release
    };
  } catch (err) {
    release();
    throw err;
  }
}

// view/onnx-runtime.ts
var ortByUrl = /* @__PURE__ */ new Map();
var configuring = /* @__PURE__ */ new WeakMap();
function serialise(ort, work) {
  const next = (configuring.get(ort) ?? Promise.resolve()).then(work, work);
  configuring.set(
    ort,
    next.catch(() => {
    })
  );
  return next;
}
var loadOrt = (url) => {
  let pending = ortByUrl.get(url);
  if (!pending) {
    pending = import(
      /* @vite-ignore */
      url
    ).catch((err) => {
      ortByUrl.delete(url);
      throw err;
    });
    ortByUrl.set(url, pending);
  }
  return pending;
};
async function preferredProviders() {
  const gpu = globalThis.navigator?.gpu;
  if (!gpu) return ["wasm"];
  try {
    return await gpu.requestAdapter() ? ["webgpu", "wasm"] : ["wasm"];
  } catch {
    return ["wasm"];
  }
}
var usesGpu = (eps) => {
  const first = eps[0];
  if (first === void 0) return false;
  return (typeof first === "string" ? first : first.name) === "webgpu";
};
function defaultThreadCount(isolated = typeof globalThis.crossOriginIsolated === "boolean" ? globalThis.crossOriginIsolated : false, cores = globalThis.navigator?.hardwareConcurrency ?? 1) {
  if (!isolated) return 1;
  return Math.max(1, Math.min(cores - 2, 6));
}
async function createModelRunner(modelUrl, opts = {}) {
  const ort = await loadOrt(opts.ortUrl ?? "./ort.mjs");
  const executionProviders = opts.executionProviders ?? await preferredProviders();
  const gpu = usesGpu(executionProviders);
  const session = await serialise(ort, async () => {
    ort.env.wasm.numThreads = opts.numThreads ?? defaultThreadCount();
    ort.env.wasm.proxy = !gpu;
    ort.env.wasm.wasmPaths = opts.wasmPaths ?? "./";
    return ort.InferenceSession.create(modelUrl, {
      executionProviders,
      graphOptimizationLevel: "all"
    });
  });
  const inputName = session.inputNames[0];
  const outputName = session.outputNames[0];
  if (!inputName || !outputName) throw new Error("model has no input/output tensor");
  const run = async (input, imgsz) => {
    const tensor = new ort.Tensor("float32", input, [1, 3, imgsz, imgsz]);
    const result = await session.run({ [inputName]: tensor });
    const out = result[outputName];
    if (!out) throw new Error(`model produced no '${outputName}' output`);
    if (out.type !== "float32" || !(out.data instanceof Float32Array)) {
      throw new Error(`model output '${outputName}' is ${out.type}, not float32`);
    }
    const anchors = out.dims[out.dims.length - 1] ?? 0;
    if (out.dims.length < 2 || !Number.isInteger(anchors) || anchors <= 0) {
      throw new Error(
        `model output '${outputName}' has dims [${out.dims.join(", ")}], which has no anchor axis`
      );
    }
    const rows = out.data.length / anchors;
    if (!Number.isInteger(rows)) {
      throw new Error(
        `model output '${outputName}' holds ${out.data.length} floats, which is not a whole number of ${anchors}-anchor rows`
      );
    }
    return { data: out.data, anchors };
  };
  if (opts.warmUp ?? true) {
    const meta = session.inputMetadata?.[0];
    const dims = meta?.isTensor ? meta.shape : void 0;
    const h = dims?.[2];
    const side = typeof h === "number" && h > 0 ? h : IMG_SIZE;
    try {
      await run(new Float32Array(3 * side * side), side);
    } catch (err) {
      await session.release().catch(() => {
      });
      throw err;
    }
  }
  return Object.assign(run, {
    dispose: () => session.release()
  });
}

// view/web-detector.ts
var WebDetector = class {
  /**
   * @param video   returns the element the stream plays into — a getter, not the element itself, so
   *                the detector survives the owner re-rendering its DOM (a custom element rebuilds
   *                its shadow root on every reconnect) and always drives the CURRENT `<video>`. A
   *                display:none video stops delivering frames in some browsers, so the owner keeps
   *                it laid out.
   * @param modelUrl read at `load()` time, so a host may set it after construction.
   */
  constructor(video, modelUrl) {
    this.video = video;
    this.modelUrl = modelUrl;
  }
  source = null;
  run = null;
  opening = null;
  get device() {
    return this.source?.device ?? null;
  }
  async use(opts = {}) {
    this.stop();
    const opening = new AbortController();
    this.opening = opening;
    try {
      const source = await openCamera(this.video(), opts, opening.signal);
      this.source = source;
    } finally {
      if (this.opening === opening) this.opening = null;
    }
  }
  async load() {
    if (this.run) return;
    const modelUrl = this.modelUrl();
    const wasmPaths = new URL(modelUrl.replace(/[^/]+$/, "") || "./", document.baseURI).href;
    const ortUrl = `${wasmPaths}ort.mjs`;
    this.run = await createModelRunner(modelUrl, { wasmPaths, ortUrl });
  }
  async next() {
    if (!this.source) throw new Error("no camera open \u2014 call use() first");
    if (!this.run) throw new Error("model not loaded \u2014 call load() first");
    let frame;
    try {
      frame = this.source.grab();
    } catch {
      return null;
    }
    const pre = preprocess(frame);
    return this.run(pre.data, pre.imgsz);
  }
  cameras() {
    return listCameras();
  }
  stop() {
    this.opening?.abort();
    this.opening = null;
    this.source?.stop();
    this.source = null;
  }
  dispose() {
    this.stop();
    const run = this.run;
    this.run = null;
    void run?.dispose?.().catch(() => {
    });
  }
};

// view/pick-detector.ts
function absentCommand(err) {
  const text = typeof err === "string" ? err : err?.message ?? "";
  return /not found|unknown command/i.test(text);
}
async function pickDetector(opts) {
  const invoke = globalThis.__TAURI__?.core?.invoke;
  if (invoke) {
    try {
      if (await invoke(`${CUBE_VISION}probe`) === true) {
        return { detector: new NativeDetector(invoke), runtime: "native" };
      }
    } catch (err) {
      (absentCommand(err) ? console.info : console.warn)(
        `[cubus] no native cube-vision runtime \u2014 using the browser one${absentCommand(err) ? "" : " after an unexpected failure"}`,
        err
      );
    }
  }
  return { detector: new WebDetector(opts.video, opts.modelUrl), runtime: "web" };
}

// view/camera-session.ts
var CameraSession = class {
  detectorPromise = null;
  detector = null;
  timer = null;
  generation = 0;
  epoch = 0;
  /** Bumped by `use()`, so an injection beats a probe that is still in flight. See `use`. */
  detectorChoice = 0;
  /** The `detector.use()` still in flight, so the next one queues behind it. See `open`. */
  opening = null;
  /** Which backend was chosen. Read by the panel purely to report it. */
  runtime = null;
  /** The open camera, or null. Null is also how the panel knows to stop showing a lens. */
  device = null;
  /** The model is loaded once per detector and survives a stop()/start(). */
  modelLoaded = false;
  /**
   * Begin an attempt, superseding every earlier one AND every frame in flight. Hold the token and
   * check `current()`.
   */
  beginAttempt() {
    this.epoch++;
    return ++this.generation;
  }
  /** Is the attempt holding this token still the one that should finish? */
  current(token) {
    return token === this.generation;
  }
  /** The token an in-flight inference must still match when it returns. */
  frameEpoch() {
    return this.epoch;
  }
  /** May a frame from `epoch` still be acted on? False once the loop stopped or the scan moved on. */
  freshFrame(epoch) {
    return epoch === this.epoch && this.timer !== null;
  }
  /** The detector, if one has been chosen. */
  get chosen() {
    return this.detector;
  }
  /**
   * Inject a detector — the tests' seam, and the native host's.
   *
   * Retires whatever was there: a replaced detector may hold a live camera, and dropping the
   * reference would leak it with nothing able to close it. The choice is versioned so a
   * `pickDetector` probe still in flight cannot resolve afterwards and overwrite the injection —
   * the panel calls `useDetector` before `start()`, but nothing stopped a host doing it in the
   * other order, and the loser of that race was silent.
   *
   * It ABANDONS the scan, and says so here because it cannot restart one: a `start()` in flight
   * finds itself superseded and returns, the loop stops, and no frame from the old detector can
   * still land. A caller injecting mid-scan owns calling `start()` afterwards. Doing it for them
   * would mean this method deciding a camera should be open, which is the panel's call and not
   * the session's — the session never speaks.
   */
  use(detector, runtime) {
    if (this.detector && this.detector !== detector) this.detector.dispose?.();
    this.detector?.stop();
    this.generation++;
    this.epoch++;
    this.stopLoop();
    this.detectorChoice++;
    this.detector = detector;
    this.detectorPromise = Promise.resolve(detector);
    this.runtime = runtime;
    this.modelLoaded = false;
    this.device = null;
  }
  /**
   * The detector, chosen once and kept for the session's life, so the model survives a stop()/
   * start() and the native probe runs only once. Cached as a promise because the choice is async.
   */
  ensureDetector(video, modelUrl) {
    if (this.detectorPromise === null) {
      const choice = this.detectorChoice;
      this.detectorPromise = pickDetector({ video, modelUrl }).then(({ detector, runtime }) => {
        if (choice !== this.detectorChoice) {
          detector.dispose?.();
          detector.stop();
          return this.detector ?? detector;
        }
        this.detector = detector;
        this.runtime = runtime;
        return detector;
      });
    }
    return this.detectorPromise;
  }
  /** Release the camera, keeping the detector (and therefore the loaded model). */
  releaseCamera() {
    this.detector?.stop();
    this.device = null;
  }
  /** Stop ticking. Does not touch the camera — `restart` keeps the lens alive on purpose. */
  stopLoop() {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
  /**
   * Start ticking, and supersede every frame in flight. Replaces any existing loop rather than
   * running two.
   *
   * The invalidation belongs HERE and not at the call site. It used to be a separate
   * `dropFramesInFlight()` the one caller had to remember alongside this, which is a two-call
   * protocol enforced by nothing: a second caller restarting the loop directly would make an
   * inference from the previous loop pass `freshFrame` again the instant the new timer existed.
   */
  beginLoop(ms, tick) {
    this.stopLoop();
    this.epoch++;
    this.timer = setInterval(tick, ms);
  }
  /** Supersede everything in flight, stop ticking, and release the camera. */
  close() {
    this.generation++;
    this.epoch++;
    this.stopLoop();
    this.releaseCamera();
  }
  /**
   * Open a camera, preferring `deviceId` but never dead-ending on it.
   *
   * `token` is the caller's attempt. A superseded attempt does NOT clean up after itself: whoever
   * bumped the generation — a newer `start()`, or `close()` — has already called `releaseCamera()`,
   * and this detector is SHARED, so a late `stop()` here would close the camera the newer attempt
   * has just opened. Rethrowing is the whole of the correct behaviour.
   *
   * Opens are SERIALISED, and that is what makes the rule above safe. `use()` mutates the shared
   * detector's camera, so two of them in flight race to be last, and the loser is whichever
   * happens to settle later — not whichever is current. `WebDetector` hides this by aborting a
   * pending open when the next one starts; `NativeDetector` did not until it was made to, and the
   * `Detector` contract is what says it must, so the ordering cannot rest on it.
   *
   * A CHAIN, not a barrier. The first attempt at this snapshotted the pending open and awaited it,
   * which serialises two attempts and not three: with A pending, B and C both snapshot A, so both
   * start the moment A settles and race each other exactly as before. Measured — three opens
   * arriving A, B, C and settling A, C, B left the detector on B while C was current. Each link
   * has to queue behind the ACTUAL latest, which means assigning the new tail before awaiting it.
   *
   * Serialising is also what lets a superseded attempt clean up after itself again. Its `stop()`
   * used to close whatever camera was open — including a newer attempt's — because the two ran
   * concurrently. Inside the chain nothing else is running: the next link starts after this one
   * returns, so releasing here can only release what THIS attempt opened, and not doing it leaves
   * a camera live with nothing showing it. That is what `stop()` during an open used to do — the
   * panel released the camera, the pending open then settled and reopened it, and painting ran
   * with the lens on and the app reporting no device.
   */
  async open(detector, opts, token) {
    const run = async () => {
      try {
        await detector.use(opts);
        return { fellBack: false };
      } catch (err) {
        if (opts.deviceId === void 0 || !this.current(token)) throw err;
        const { deviceId: _dropped, ...fallback } = opts;
        await detector.use(fallback);
        return { fellBack: true };
      } finally {
        if (!this.current(token)) detector.stop();
      }
    };
    const chained = (this.opening ?? Promise.resolve()).then(run, run);
    this.opening = chained.then(
      () => void 0,
      () => void 0
    );
    return chained;
  }
};

// view/stillness.ts
var Stillness = class {
  /**
   * @param reads Identical consecutive reads required.
   * @param ms Wall-clock stillness required, from the first read of the current run.
   */
  constructor(reads, ms) {
    this.reads = reads;
    this.ms = ms;
  }
  /**
   * The read the current run is made of, or null when there is no run.
   *
   * `null` rather than `''`, because `''` is also what an empty read joins to — so an empty first
   * read used to look like a CONTINUATION of a run that had already been reset, and inherit its
   * start time. Unreachable from the scanner (a read is always nine stickers) and kept impossible
   * rather than merely unlikely, since the sentinel costs nothing to make unambiguous.
   */
  key = null;
  count = 0;
  since = 0;
  /**
   * Offer the latest read. True once it has been identical `reads` times AND still for `ms`.
   *
   * `now` is injectable because the alternative is a test that sleeps: the timing rule is the whole
   * point of this class, so it has to be drivable without wall-clock waits.
   *
   * The default clock is MONOTONIC. `Date.now()` is not: it follows an NTP correction or a manual
   * clock change, and a step forward of half a second satisfies the duration gate outright — the
   * one thing this class exists to refuse. "Held still for 500 ms" is a claim about elapsed time,
   * so it is measured with the clock that only measures elapsed time.
   */
  offer(colors, now = performance.now()) {
    const key = colors.join(",");
    if (key === this.key) {
      this.count += 1;
    } else {
      this.key = key;
      this.count = 1;
      this.since = now;
    }
    return this.count >= this.reads && now - this.since >= this.ms;
  }
  /** Forget the current run — the cube left the frame, or the scan was restarted. */
  reset() {
    this.key = null;
    this.count = 0;
    this.since = 0;
  }
};

// view/ai-scan-panel.ts
var GUIDE = {
  U: { color: "WHITE", name: "Up", swatch: "#f6f7f8" },
  R: { color: "RED", name: "Right", swatch: "#d0202a" },
  F: { color: "GREEN", name: "Front", swatch: "#049e4a" },
  D: { color: "YELLOW", name: "Down", swatch: "#ffd400" },
  L: { color: "ORANGE", name: "Left", swatch: "#ff6a00" },
  B: { color: "BLUE", name: "Back", swatch: "#0057c8" }
};
var CLASS_SWATCH = FACES.map((f) => GUIDE[f].swatch);
var FRAME_HINT = {
  NO_FACE: "",
  PARTIAL_FACE: " Get the whole side in the frame.",
  BAD_GEOMETRY: " Hold it flatter and steadier."
};
var TICK_MS_WEB = 200;
var TICK_MS_NATIVE = 60;
var STABLE = 3;
var STABLE_MS = 500;
var TICK_FAIL_MS = 3e3;
var CHECK_BEAT_MS = 350;
var OPENING = "Show any side to the camera \u2014 held flat and centred.";
var PAINTING = "Painting by hand \u2014 tap any sticker and pick its colour.";
var SLOW_OPEN_MS = 8e3;
var SLOW_OPEN = "The camera has not opened. Allow camera access for this app, then try again.";
var PINNED_GONE = "The camera you chose is unavailable \u2014 using the default one.";
var TEMPLATE = `
<style>
  :host { display: block; font: 14px/1.5 -apple-system, system-ui, sans-serif; color: #e6edf3; }
  .stage { position: relative; aspect-ratio: 1; background: #000; border-radius: 12px; overflow: hidden; }
  .stage.flash { animation: cap .5s ease; }
  @keyframes cap {
    0% { box-shadow: inset 0 0 0 0 rgba(63,185,80,0); }
    30% { box-shadow: inset 0 0 0 6px #3fb950; }
    100% { box-shadow: inset 0 0 0 0 rgba(63,185,80,0); }
  }
  video { width: 100%; height: 100%; object-fit: cover; display: block; }
  .status { margin: 12px 0 4px; min-height: 22px; } .status b { color: #fff; }
  .dots { display: flex; gap: 6px; margin: 8px 0; }
  .dots span { width: 26px; height: 14px; border-radius: 3px; border: 1px solid rgba(0,0,0,.4); opacity: .28; }
  .dots span.done { opacity: 1; box-shadow: 0 0 0 2px rgba(63,185,80,.45); }
  .preview { display: none; grid-template-columns: repeat(3, 36px); gap: 4px; margin: 10px 0; }
  .preview[data-show='1'] { display: grid; }
  .preview i { width: 36px; height: 36px; border-radius: 6px; border: 1px solid rgba(0,0,0,.4); }
  .row { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 6px; }
  button { font: inherit; border: 0; border-radius: 7px; padding: 8px 16px; font-weight: 600; cursor: pointer; }
  button.primary { background: #58a6ff; color: #06122b; }
  button.ghost { background: #21262d; color: #e6edf3; border: 1px solid #30363d; }
  button[hidden] { display: none; }
  .err { color: #f85149; } .ok { color: #3fb950; } .muted { color: #8b949e; }
</style>
<div class="stage"><video id="video" playsinline muted></video></div>
<div class="dots" id="dots"></div>
<div class="status" id="status">Click <b>Start camera</b>, then show each side to the camera.</div>
<div class="preview" id="preview"></div>
<div class="row">
  <button class="primary" id="start">Start camera</button>
  <button class="ghost" id="restart" hidden>Start over</button>
</div>
`;
var HEADLESS_TEMPLATE = `
<style>
  :host {
    position: fixed; left: 0; top: 0; width: 1px; height: 1px;
    overflow: hidden; clip-path: inset(50%); pointer-events: none;
  }
</style>
<video id="video" playsinline muted></video>
`;
var AiScanPanel = class extends HTMLElement {
  root;
  /** Model URL; the app can override before the element renders. */
  modelUrl = "./vendor/cube-yolo.onnx";
  /** A tick is mid-inference; the next one returns rather than running two at once. */
  busy = false;
  /** `headless`: draw nothing, and let the host draw from 'scan-progress'. */
  headless = false;
  faces = {};
  /** The 9 colour classes in view right now, or null when no clean side is; rides on every report. */
  live = null;
  /**
   * The count-and-duration gate that decides a read is worth capturing.
   *
   * It replaces three fields that FOUR different sites reset by hand, three of them clearing only
   * two of the three. That was harmless — clearing the key forces the "new run" branch, which
   * reassigns the timestamp — but harmless by a coincidence of control flow two branches away is
   * not the same as correct, and it is what makes the next edit to that branch dangerous. One
   * object with one reset needs no coincidence, and the timing rule becomes testable without a
   * camera, a detector, a timer and a DOM element.
   */
  still = new Stillness(STABLE, STABLE_MS);
  /**
   * The camera, its detector, its loop, and the two counters that keep a stale attempt or a
   * stale frame from speaking. It never speaks itself — see CameraSession.
   */
  cam = new CameraSession();
  /** When the current run of failing ticks began, or null when the last tick completed. */
  tickFailingSince = null;
  /** Captures known to be in canonical rotation, from answering a `confirm` request. */
  confirmed = {};
  awaiting = null;
  /** Hand-painting mode: the camera is off and every non-centre sticker is settable. */
  painting = false;
  /** Contradictory confirmations this scan; past one, the notice starts offering restart too. */
  mismatches = 0;
  /**
   * The scan reached a valid cube and delivered it. A finished scan is a state, not a moment:
   * the camera can be reopened over it (picking a camera from the host's menu does exactly that),
   * and without this flag the loop would hungrily nag "show a side" over a complete cube — and a
   * side idly held in view would REPLACE part of an accepted scan. While finished, ticks guide
   * instead of capture; any re-check (a correction, a rescan, a restart) clears it.
   */
  finished = false;
  /** The pinned explanation riding on every report; null when nothing needs saying. */
  notice = null;
  /** Where a colour misread most plausibly is; rides on every report so a host can mark them. */
  suspects = [];
  /** The pending deferred assembly (see CHECK_BEAT_MS); epoch-guarded and cleared on stop(). */
  checkTimer = null;
  constructor() {
    super();
    this.root = this.attachShadow({ mode: "open" });
  }
  connectedCallback() {
    this.headless = this.hasAttribute("headless");
    this.root.innerHTML = this.headless ? HEADLESS_TEMPLATE : TEMPLATE;
    if (!this.headless) {
      this.buildDots();
      this.buildPreview();
      this.maybe("start")?.addEventListener("click", () => void this.start());
      this.maybe("restart")?.addEventListener("click", () => this.restart());
    }
    if (this.hasAttribute("autostart")) queueMicrotask(() => void this.start());
  }
  disconnectedCallback() {
    this.stop();
  }
  /**
   * Why the camera must not open right now — one answer, consulted by every entry point.
   *
   * This replaces three half-guards that each protected one caller and left the others. `start()`
   * had a generation counter, which defends against a LATER start superseding an in-flight one and
   * cannot see that the element has been removed: it takes a fresh generation, so the
   * `queueMicrotask(() => start())` queued by connectedCallback still opened the camera on an
   * element that disconnectedCallback had already stopped. And nothing at all stopped `start()`
   * while painting, though setPainting's own comment calls the modes "exclusive by nature" — so
   * the Start button that `stop()` helpfully re-revealed would open a camera whose captures
   * overwrite the stickers the user had just painted.
   *
   * Both are the same absence: the two facts that gate the camera were never asked in one place.
   */
  cameraRefusal() {
    if (!this.isConnected) return "detached";
    if (this.painting) return "painting";
    return null;
  }
  /** Release the camera + stop the loop. Safe repeatedly and before first render. The detector
   *  itself is kept, so the loaded model survives a stop()/start() (only the camera is released). */
  stop() {
    if (this.checkTimer !== null) {
      clearTimeout(this.checkTimer);
      this.checkTimer = null;
    }
    this.cam.close();
    this.showPreview(null);
    const start = this.maybe("start");
    if (start) {
      start.disabled = false;
      start.hidden = this.painting;
    }
    const restart = this.maybe("restart");
    if (restart) restart.hidden = true;
  }
  el(id) {
    const node = this.root.getElementById(id);
    if (!node) throw new Error(`ai-scan-panel: missing #${id}`);
    return node;
  }
  /** Same lookup, but tolerant: headless renders none of the status/preview chrome. */
  maybe(id) {
    return this.root.getElementById(id);
  }
  /**
   * Open the camera and begin scanning. Public so a host can autostart it, or retry an error.
   * Deliberately does NOT clear captured sides: switching cameras mid-scan, or reopening after
   * painting, must not cost the user the sides they already showed. `restart()` is the wipe.
   *
   * WHO OWNS THE CAMERA. The detector is ONE object shared by every attempt, so `detector.stop()`
   * closes whatever camera is open right now — not "this attempt's camera", which does not exist
   * as a separate thing. A superseded attempt therefore cleans up NOTHING and simply returns: the
   * only two things that can supersede one are a newer `start()` and `close()`, and both call
   * `releaseCamera()` themselves before opening anything. Tidying up on the way out looked
   * obviously right and closed the newer attempt's camera — a start superseded while awaiting a
   * permission prompt would land afterwards and shut off the lens that had just been granted.
   */
  async start() {
    const refusal = this.cameraRefusal();
    if (refusal !== null) {
      if (refusal === "painting") this.report("painting", PAINTING);
      return;
    }
    const startBtn = this.maybe("start");
    if (startBtn) startBtn.disabled = true;
    const gen = this.cam.beginAttempt();
    this.report("starting", "Opening the camera\u2026");
    this.cam.releaseCamera();
    const detector = await this.ensureDetector();
    if (!this.cam.current(gen)) return;
    const slowOpen = setTimeout(() => {
      if (this.cam.current(gen) && this.cam.device === null) {
        this.report("error", this.tinted("err", SLOW_OPEN));
      }
    }, SLOW_OPEN_MS);
    try {
      const facing = this.getAttribute("facing");
      const facingMode = facing === "user" || facing === "environment" ? facing : void 0;
      const pinned = this.getAttribute("device-id") || void 0;
      const { fellBack } = await this.cam.open(detector, { deviceId: pinned, facingMode }, gen);
      if (!this.cam.current(gen)) return;
      this.cam.device = detector.device;
      if (startBtn) startBtn.hidden = true;
      if (!this.cam.modelLoaded) {
        this.report("loading", "Camera ready \u2014 loading the model\u2026");
        await detector.load();
        this.cam.modelLoaded = true;
        if (!this.cam.current(gen)) return;
      }
      const phase = this.awaiting ? "confirm" : "scanning";
      const opening = this.awaiting ? this.confirmWords(this.awaiting) : [OPENING];
      if (fellBack) this.loop(phase, this.tinted("err", PINNED_GONE), " ", ...opening);
      else this.loop(phase, ...opening);
    } catch (err) {
      this.startFailed(err, gen, startBtn);
    } finally {
      clearTimeout(slowOpen);
    }
  }
  /**
   * A camera that would not open: re-offer Start, and say which of the several causes it was.
   *
   * Lifted out of start(), which was 100 lines of which a quarter was this. The happy path and the
   * failure path share nothing but their variables, and reading either meant scrolling past the
   * other. The generation is passed rather than re-read because it is the caller's attempt that is
   * being judged, not whatever attempt is current by the time this runs.
   */
  startFailed(err, gen, startBtn) {
    if (!this.cam.current(gen)) return;
    if (startBtn) {
      startBtn.hidden = false;
      startBtn.disabled = false;
    }
    this.report(
      "error",
      this.tinted("err", `Cannot start: ${String(err?.message ?? err)}`)
    );
  }
  /**
   * The detector, chosen once and kept for the element's life (so the model survives a stop()/
   * start(), and so the probe runs only once). Cached as a promise because the choice is async — it
   * asks the plugin whether it is there.
   */
  ensureDetector() {
    return this.cam.ensureDetector(
      () => this.el("video"),
      () => this.modelUrl
    );
  }
  /**
   * Adopt a ready Detector and skip the async probe. A test seam: driving the full capture loop
   * in a DOM test needs a fake detector in place before start(), and the probe would race it.
   * Production hosts never call this — the panel chooses its own detector.
   */
  useDetector(detector, runtime) {
    this.cam.use(detector, runtime);
    this.announceRuntime();
  }
  /** Say which runtime won, once, on the console — so "is it on the fast native path?" has an
   *  answer without a debugger. The same fact rides on every 'scan-progress' event as `runtime`. */
  announceRuntime() {
    const where = this.cam.runtime === "native" ? "native (CoreML on the ANE, ~1.5 ms/frame)" : "web (wasm model, ~400 ms/frame)";
    console.info(`[cubus] scanner runtime: ${where}`);
  }
  reset() {
    this.still.reset();
    this.live = null;
    this.confirmed = {};
    this.awaiting = null;
    this.mismatches = 0;
    this.finished = false;
    this.notice = null;
    this.suspects = [];
    for (const f of FACES) delete this.faces[f];
    this.buildDots();
  }
  /**
   * (Re)start the capture loop. `opening` replaces the standard prompt, so a message explaining
   * why we are starting over survives instead of being overwritten within one tick.
   */
  loop(phase, ...opening) {
    this.cam.stopLoop();
    this.showPreview(null);
    this.still.reset();
    this.tickFailingSince = null;
    const restart = this.maybe("restart");
    if (restart) restart.hidden = false;
    if (this.cam.device === null) {
      void this.start();
      return;
    }
    this.report(phase, ...opening.length > 0 ? opening : [OPENING]);
    const tick = this.cam.runtime === "native" ? TICK_MS_NATIVE : TICK_MS_WEB;
    this.cam.beginLoop(tick, () => void this.onTick());
  }
  stopLoop() {
    this.cam.stopLoop();
  }
  async onTick() {
    if (this.busy || this.cam.device === null || !this.cam.chosen || !this.cam.modelLoaded) return;
    this.busy = true;
    const epoch = this.cam.frameEpoch();
    try {
      const output = await this.cam.chosen.next();
      if (!this.cam.freshFrame(epoch)) return;
      this.tickFailingSince = null;
      if (output === null) {
        this.still.reset();
        return;
      }
      const fit = fitFromOutput(output);
      if (!fit.ok) {
        this.still.reset();
        this.showPreview(null);
        this.report(
          this.awaiting ? "confirm" : "scanning",
          this.idleLine() + FRAME_HINT[fit.reason]
        );
        return;
      }
      const settled = this.still.offer(fit.face.colors);
      this.showPreview(fit.face.colors);
      if (!settled) {
        this.report(this.awaiting ? "confirm" : "scanning", "Reading a side \u2014 hold still\u2026");
        return;
      }
      this.fileSettledRead(fit.face);
    } catch (err) {
      if (!this.cam.freshFrame(epoch)) return;
      const now = Date.now();
      this.tickFailingSince ??= now;
      if (now - this.tickFailingSince >= TICK_FAIL_MS) {
        this.tickFail(err);
      }
    } finally {
      this.busy = false;
    }
  }
  /**
   * Ticks have failed for TICK_FAIL_MS: stop, say so, and leave a way back on.
   *
   * The way back is the part that was missing. This used to call `stopLoop()` and nothing else,
   * while the notice it wrote told the user to press Start — a button `start()` had hidden the
   * moment the camera opened. The camera is released too: the failure is in reading from it, and a
   * lens left live under a dead loop is a light on for nothing.
   */
  tickFail(err) {
    this.cam.close();
    this.showPreview(null);
    const start = this.maybe("start");
    if (start) {
      start.hidden = false;
      start.disabled = false;
    }
    this.notice = {
      title: "The scanner stopped",
      tone: "err",
      body: "The camera opened but no frame could be read for several seconds. Try Start again, and if it keeps happening the model or the camera driver is at fault rather than the cube."
    };
    this.report("error", "Could not read from the camera.");
    console.error("[ai-scan-panel] scan loop stopped after repeated failures", err);
  }
  /**
   * A read that has held still: work out which side it is, and file it.
   *
   * Split out of onTick, which had grown to 117 lines covering four unrelated decisions —
   * whether the loop should run at all, whether the frame is usable, whether the cube has
   * stopped moving, and what the resulting read means. Only the last one is about cubes.
   */
  fileSettledRead(read) {
    const centre = read.colors[4];
    const face = centre === void 0 ? void 0 : FACES[centre];
    if (this.awaiting) {
      if (face !== this.awaiting.face) {
        this.report("confirm", ...this.confirmWords(this.awaiting));
        return;
      }
      this.confirmed[face] = read;
      this.awaiting = null;
      this.flash();
      this.scheduleCheck(this.tinted("ok", "Got it \u2014 checking\u2026"));
      return;
    }
    if (face === void 0) {
      this.report("scanning", this.tinted("err", "Couldn't read the centre \u2014 hold it steadier."));
      return;
    }
    if (this.finished) {
      this.report(
        "scanning",
        "This cube is already scanned \u2014 tap a sticker to fix one, or start the scan over for a different cube."
      );
      return;
    }
    if (this.faces[face]) {
      if (this.capturedFaces().length >= FACES.length) {
        if (read.colors.join(",") === this.faces[face].colors.join(",")) {
          this.report(
            "scanning",
            "The ",
            this.bold(GUIDE[face].name),
            " side reads the same as before \u2014 tap a sticker to fix it, or show another side."
          );
          return;
        }
        this.faces[face] = read;
        this.confirmed = {};
        this.mismatches = 0;
        this.buildDots();
        this.flash();
        this.scheduleCheck(this.tinted("ok", `Re-read the ${GUIDE[face].name} side \u2014 checking\u2026`));
        return;
      }
      const named = this.missingSides();
      this.report(
        "scanning",
        "Already have the ",
        this.bold(GUIDE[face].name),
        named ? ` side \u2014 still need ${named}.` : " side \u2014 show a different one."
      );
      return;
    }
    this.capture(face, read);
  }
  /** File a freshly-recognised face under its own letter, then keep scanning (or finish at six). */
  capture(face, read) {
    this.faces[face] = read;
    this.still.reset();
    this.buildDots();
    this.flash();
    const done = this.capturedFaces().length;
    if (done >= FACES.length) {
      this.scheduleCheck(this.tinted("ok", "All six sides captured \u2014 checking\u2026"));
      return;
    }
    const named = this.missingSides();
    this.report(
      "scanning",
      "Got the ",
      this.bold(GUIDE[face].name),
      ` side \u2014 ${done}/6. ${named ? `Still to show: ${named}.` : "Show another side\u2026"}`
    );
  }
  /**
   * Stop the loop, report 'checking', and run the assembly one beat later (CHECK_BEAT_MS), so the
   * capture or correction that triggered the check paints before any verdict replaces it. Clears
   * the pinned notice: whatever it explained is being re-decided right now. Epoch-guarded, so a
   * restart or navigation during the beat cancels the stale check.
   */
  scheduleCheck(...opening) {
    this.stopLoop();
    this.showPreview(null);
    this.finished = false;
    this.notice = null;
    this.suspects = [];
    this.report("checking", ...opening);
    const epoch = this.cam.frameEpoch();
    if (this.checkTimer !== null) clearTimeout(this.checkTimer);
    this.checkTimer = setTimeout(() => {
      this.checkTimer = null;
      if (epoch === this.cam.frameEpoch()) this.assemble();
    }, CHECK_BEAT_MS);
  }
  /** The sides captured so far, in URFDLB order — the shape hosts draw progress from. */
  capturedFaces() {
    const out = [];
    for (const face of FACES) {
      const read = this.faces[face];
      if (read) out.push({ face, colors: [...read.colors] });
    }
    return out;
  }
  /**
   * Correct one sticker of an already-captured side, and re-check the cube. The detector is good,
   * not perfect — held-out colour accuracy is ~90%, and orange and white are its weak classes —
   * so a scan can fail on a single misread sticker that a person can see at a glance.
   *
   * Only a side already READ can be corrected — there is nothing to overrule otherwise. `index` is
   * into the capture as shown, which is what a host displays, so a click maps straight through.
   * The centre is not correctable: a face's centre colour is its identity, and changing one would
   * rename the face rather than fix it.
   *
   * Any confirmations already gathered are dropped, because they were answers about a reading
   * that no longer exists.
   */
  setSticker(face, index, colour) {
    if (!Number.isInteger(index) || index < 0 || index > 8 || index === 4) return;
    if (!Number.isInteger(colour) || colour < 0 || colour >= FACES.length) return;
    let read = this.faces[face];
    if (read === void 0) {
      if (!this.painting) return;
      read = {
        colors: Array(9).fill(FACES.indexOf(face)),
        confidence: Array(9).fill(1)
      };
      this.faces[face] = read;
      this.buildDots();
    } else if (read.colors[index] === colour) {
      return;
    }
    read.colors[index] = colour;
    read.confidence[index] = 1;
    this.confirmed = {};
    this.awaiting = null;
    this.mismatches = 0;
    this.finished = false;
    this.notice = null;
    this.suspects = [];
    const done = this.capturedFaces().length;
    if (this.painting) {
      this.afterPaintStroke(face, done);
      return;
    }
    if (done < FACES.length) {
      this.report("scanning", `Corrected the ${GUIDE[face].name} side. Show another side\u2026`);
      return;
    }
    this.scheduleCheck(this.tinted("ok", "Corrected \u2014 checking\u2026"));
  }
  /**
   * A stroke landed while the user is authoring the cube: check it, and act only on a
   * finished one.
   *
   * Half of setSticker was this branch, and it shares nothing with the correction path
   * below it but the bookkeeping above them both. A half-painted cube is invalid BY
   * DEFINITION, so reporting each stroke as a failure would be noise rather than news —
   * and once all six sides are there, silence stops being kindness.
   */
  afterPaintStroke(face, done) {
    if (done === FACES.length) {
      const result = assemblePainted(this.faces);
      if (result.valid) {
        this.finish(result);
        return;
      }
      this.suspects = result.suspects ?? [];
      this.dispatchEvent(new CustomEvent("scan-invalid", { detail: result }));
      this.notice = this.misreadNotice(result, {
        one: "If it is wrong, tap it and pick the colour you see.",
        many: "Check those sides against the cube in your hand and repaint what does not match."
      }) ?? {
        title: "Not solvable yet",
        tone: "info",
        body: `${result.reason ?? "Not a legal cube yet"} \u2014 check the sides against your cube.`
      };
    }
    this.report(
      "painting",
      `Painted the ${GUIDE[face].name} side \u2014 ${done}/${FACES.length} sides.`
    );
  }
  /**
   * Turn hand-painting on or off. The two are exclusive by nature, not by policy: painting means
   * the user is authoring the cube, and a camera that kept reading would overwrite what they typed
   * in. So turning it on releases the camera, and turning it off opens it again from scratch.
   */
  setPainting(on) {
    if (on === this.painting) return;
    this.painting = on;
    this.notice = null;
    this.suspects = [];
    if (on) {
      this.stop();
      this.report("painting", PAINTING);
      return;
    }
    void this.start();
  }
  /**
   * Forget one side's reading so the camera can read it again — the sensible thing for a centre
   * sticker to do, since a centre cannot be colour-corrected without renaming the face.
   *
   * Every confirmation gathered so far answered a question about a reading that included this
   * side, so they go too. The capture loop is restarted, because it stops once six sides are in
   * and dropping one means there is something to look for again.
   */
  rescanFace(face) {
    if (!this.faces[face]) return;
    delete this.faces[face];
    this.confirmed = {};
    this.awaiting = null;
    this.mismatches = 0;
    this.finished = false;
    this.notice = null;
    this.suspects = [];
    this.buildDots();
    this.loop("scanning", `Show the ${GUIDE[face].color} side again \u2014 it will be read fresh.`);
  }
  /**
   * The selectable cameras. Labels are only filled in once camera permission has been granted,
   * so a host gets named entries by calling this after the first successful start().
   */
  async cameras() {
    return (await this.ensureDetector()).cameras();
  }
  /**
   * Throw the whole scan away and scan afresh — the ONLY thing that clears captured sides.
   * Public for host UIs; with the camera dark it is also the way back on, so a host needs just
   * this one call behind its restart control.
   */
  restart() {
    this.reset();
    if (this.painting) {
      this.report("painting", PAINTING);
      return;
    }
    this.loop("scanning");
  }
  /** Brief green border pulse on the stage to confirm a capture. */
  flash() {
    const stage = this.root.querySelector(".stage");
    if (!(stage instanceof HTMLElement)) return;
    stage.classList.remove("flash");
    void stage.offsetWidth;
    stage.classList.add("flash");
  }
  /** "Show the GREEN side again, with WHITE facing up." — the whole instruction, as nodes. */
  confirmWords(req) {
    return [
      "Show the ",
      this.bold(GUIDE[req.face].color),
      " side again, with ",
      this.bold(GUIDE[req.up].color),
      " facing up."
    ];
  }
  /** The same instruction as a plain sentence, for the pinned notice. */
  confirmSentence(req) {
    return `Show the ${GUIDE[req.face].color} side again, with ${GUIDE[req.up].color} facing up.`;
  }
  /**
   * The waiting-for-input line, matched to where the scan actually is. One generic "show any
   * side" for every state was how a finished scan kept being nagged for sides, and how the ask
   * for one SPECIFIC side got contradicted the moment the cube left the frame.
   */
  idleLine() {
    if (this.awaiting) {
      return `Looking for the ${GUIDE[this.awaiting.face].color} side \u2014 hold it with ${GUIDE[this.awaiting.up].color} up.`;
    }
    if (this.finished) return "Scan finished \u2014 start the scan over to read a different cube.";
    if (this.capturedFaces().length >= FACES.length) {
      return "Show a side to the camera to re-read it.";
    }
    return "Show any side to the camera.";
  }
  /** "YELLOW and BLUE" — the sides still to show, named once there are few enough to name. */
  missingSides() {
    const missing = FACES.filter((f) => !this.faces[f]);
    if (missing.length === 0 || missing.length > 2) return null;
    return missing.map((f) => GUIDE[f].color).join(" and ");
  }
  /** Read the six faces (plus any confirmations) into a cube, and act on what comes back. */
  assemble() {
    let result;
    for (let round = 0; ; round++) {
      try {
        result = assembleColors(this.faces, void 0, this.confirmed);
      } catch (err) {
        const why = String(err?.message ?? err);
        this.notice = {
          title: "Something went wrong",
          tone: "err",
          body: `Couldn't check the scan (${why}). Show a side again to retry, or start the scan over.`
        };
        this.loop("scanning", this.tinted("err", "Couldn\u2019t check the scan \u2014 see the note."));
        return;
      }
      const face = result.reread;
      const fresh = face === void 0 ? void 0 : this.confirmed[face];
      if (face === void 0 || fresh === void 0 || round >= FACES.length) {
        this.finish(result);
        return;
      }
      this.faces[face] = fresh;
    }
  }
  /**
   * Turn a refused reading into words. ONE implementation, for the camera and for painting.
   *
   * There were two. Painting grew its own copy the day it learned to diagnose, and within a single
   * commit the copies had already disagreed about the mathematics: the camera says "there is no
   * single sticker to point at", which is what is proven, while the painting copy said "more than
   * one wrong sticker has more than one possible repair", which is NOT — the guarantee is that
   * above distance one the nearest legal cube need not be the USER'S cube, and a given input may
   * still have a unique nearest repair. Overclaiming is the failure this project treats most
   * seriously, and duplication is how it got in.
   *
   * What genuinely differs between the modes is only how you RECOVER — show the side again, or tap
   * the sticker — so that is what the caller supplies. Classification, tone, and the proven wording
   * live here. `params` starts with the count so the sentence keeps its %1 and a catalog can
   * translate it before substitution; extra params follow as %2 onward.
   */
  misreadNotice(result, recovery) {
    const misread = result.misreadCount ?? 0;
    if (this.suspects.length > 0) {
      return {
        title: "Check the marked sticker",
        tone: "err",
        body: `Changing it would make this a solvable cube. Check it against your cube first \u2014 when more than one sticker is misread, the marked one can be a sticker that was read correctly. ${recovery.one}`
      };
    }
    if (misread > 1) {
      return {
        title: "More than one sticker looks wrong",
        tone: "err",
        body: `At least %1 stickers were misread, so there is no single sticker to point at. ${recovery.many}`,
        params: [misread, ...recovery.params ?? []]
      };
    }
    if (misread === 1) {
      return {
        title: "A sticker looks wrong",
        tone: "err",
        body: `At least %1 sticker was misread, and the reading does not pin down which one. ${recovery.many}`,
        params: [misread, ...recovery.params ?? []]
      };
    }
    return null;
  }
  /**
   * Route an assembled verdict to the one branch that handles it.
   *
   * This was 124 lines holding three unrelated jobs: settling an accepted scan, asking for a
   * side, and explaining a refusal. Nothing was shared between them but the argument, so the
   * length was the only thing making them look related — and a reader chasing one branch had
   * to step over the other two to be sure they were not reached.
   */
  finish(result) {
    this.stopLoop();
    this.showPreview(null);
    this.suspects = result.suspects ?? [];
    if (result.valid && result.lowConfidence.length === 0) {
      this.finishAccepted(result);
      return;
    }
    if (result.confirm && result.reread === void 0) {
      this.finishConfirming(result, result.confirm);
      return;
    }
    this.finishRefused(result);
  }
  /** Accepted: settle the captures into canonical rotation, release the camera, announce it. */
  finishAccepted(result) {
    const rots = result.rotations;
    if (rots) {
      FACES.forEach((f, fi) => {
        const read = this.faces[f];
        const k = rots[fi] ?? 0;
        if (read && k !== 0) {
          this.faces[f] = {
            colors: rotateFace(read.colors, k),
            confidence: rotateFace(read.confidence, k)
          };
        }
      });
    }
    this.confirmed = {};
    this.awaiting = null;
    this.mismatches = 0;
    this.finished = true;
    this.notice = null;
    this.stop();
    this.report("done", this.tinted("ok", "Scan complete \u2014 solvable cube captured."));
    this.dispatchEvent(new CustomEvent("scan-complete", { detail: result }));
  }
  /**
   * One reading is not enough: name a side to show again, and how to hold it.
   *
   * `confirm` is a parameter rather than read off `result` because the caller has already
   * established it is there. Inside the old single method a type guard did that silently; making
   * it an argument states the precondition where a reader looks for it, and the compiler keeps it.
   */
  finishConfirming(result, confirm) {
    if (result.mismatch) {
      this.confirmed = {};
      this.mismatches++;
      this.awaiting = confirm;
      this.notice = {
        title: "Those looks disagree",
        tone: "err",
        body: `One of them was held a different way up. ${this.confirmSentence(confirm)}${this.mismatches >= 2 ? " Each tile's edge colours show which way up to hold that side \u2014 or start the scan over." : ""}`
      };
      this.loop(
        "confirm",
        this.tinted("err", "Those two looks disagree. "),
        ...this.confirmWords(confirm)
      );
      return;
    }
    this.awaiting = confirm;
    this.notice = {
      title: "One more look",
      tone: "info",
      body: (result.ambiguous ? "Several readings of this cube fit what the camera saw, and six photos cannot tell them apart \u2014 another look, held as asked, narrows them. " : "A single look could have been held wrong, so another one checks it. ") + this.confirmSentence(confirm)
    };
    this.loop("confirm", ...this.confirmWords(confirm));
  }
  /** Refused: keep every capture, and say what would make it a cube. */
  finishRefused(result) {
    this.dispatchEvent(new CustomEvent("scan-invalid", { detail: result }));
    this.confirmed = {};
    this.awaiting = null;
    const hold = " Tip: hold each side the way its tile's edge colours show, and a scan settles itself.";
    const camera = this.misreadNotice(result, {
      one: `If it is wrong, tap it and pick the colour you see; if it is right, show that side again to re-read it.${hold}`,
      many: result.misreadFace ? `Show the %2 side to the camera again \u2014 it will be read fresh.${hold}` : `Show those sides to the camera again \u2014 each one is read fresh.${hold}`,
      params: result.misreadFace ? [GUIDE[result.misreadFace].color] : []
    });
    if (camera) {
      this.notice = camera;
    } else if (result.valid) {
      this.notice = {
        title: "Some stickers were unclear",
        tone: "err",
        body: "The cube reads as solvable, but some stickers were too faint to trust. Show those sides again, or tap stickers to confirm them."
      };
    } else if (result.ambiguous) {
      this.notice = {
        title: "Too symmetric to tell",
        tone: "err",
        body: "This cube reads the same several ways, and no extra look can split them. Turn any one face a quarter turn, then start the scan over to read the changed cube."
      };
    } else {
      this.notice = {
        title: "That doesn't read as a solvable cube",
        tone: "err",
        body: `Too much of the cube was read wrong to say where. Show the sides to the camera again \u2014 each one is read fresh \u2014 or start the scan over.${hold}`
      };
    }
    this.loop(
      "scanning",
      this.tinted("err", "That isn't a solvable cube yet \u2014 fix a sticker, or show a side again.")
    );
  }
  buildDots() {
    const dots = this.maybe("dots");
    if (!dots) return;
    dots.textContent = "";
    for (const face of FACES) {
      const g = GUIDE[face];
      const span = document.createElement("span");
      span.style.background = g.swatch;
      span.className = this.faces[face] ? "done" : "";
      span.title = this.faces[face] ? `${g.name} \u2014 captured` : `${g.name} \u2014 needed`;
      dots.appendChild(span);
    }
  }
  buildPreview() {
    const p = this.maybe("preview");
    if (!p) return;
    p.textContent = "";
    for (let i = 0; i < 9; i++) p.appendChild(document.createElement("i"));
  }
  showPreview(colors) {
    this.live = colors;
    const p = this.maybe("preview");
    if (!p) return;
    if (!colors) {
      p.dataset.show = "0";
      return;
    }
    const cells = p.querySelectorAll("i");
    for (let i = 0; i < 9; i++) {
      cells[i].style.background = CLASS_SWATCH[colors[i]] ?? "#000";
    }
    p.dataset.show = "1";
  }
  /**
   * Show `parts` on the built-in status line (when there is one) AND tell the host what changed.
   * Every status change goes through here, so a headless host sees exactly what a visible one does.
   */
  report(phase, ...parts) {
    const message = parts.map((p) => typeof p === "string" ? p : p.textContent ?? "").join("");
    const status = this.maybe("status");
    if (status) {
      status.textContent = "";
      status.append(...parts);
    }
    this.dispatchEvent(
      new CustomEvent("scan-progress", {
        detail: {
          phase,
          message,
          captured: this.capturedFaces(),
          live: this.live,
          device: this.cam.device,
          confirm: this.awaiting,
          runtime: this.cam.runtime,
          notice: this.notice,
          suspects: [...this.suspects],
          complete: this.finished
        }
      })
    );
  }
  bold(text) {
    const b = document.createElement("b");
    b.textContent = text;
    return b;
  }
  tinted(cls, text) {
    const span = document.createElement("span");
    span.className = cls;
    span.textContent = text;
    return span;
  }
};
if (!customElements.get("ai-scan-panel")) {
  customElements.define("ai-scan-panel", AiScanPanel);
}
export {
  AiScanPanel,
  createModelRunner,
  decodeDetections,
  defaultThreadCount,
  fitFace,
  nms,
  preferredProviders,
  preprocess
};
