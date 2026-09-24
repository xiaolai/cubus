var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __commonJS = (cb, mod) => function __require() {
  try {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  } catch (e) {
    throw mod = 0, e;
  }
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
      [centerFacelet, cornerFacelet, edgeFacelet] = (function() {
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
      })();
      centerColor = ["U", "R", "F", "D", "L", "B"];
      cornerColor = [["U", "R", "F"], ["U", "F", "L"], ["U", "L", "B"], ["U", "B", "R"], ["D", "F", "R"], ["D", "L", "F"], ["D", "B", "L"], ["D", "R", "B"]];
      edgeColor = [["U", "R"], ["U", "F"], ["U", "L"], ["U", "B"], ["D", "R"], ["D", "F"], ["D", "L"], ["D", "B"], ["F", "R"], ["F", "L"], ["B", "L"], ["B", "R"]];
      Cube3 = (function() {
        var faceNames, faceNums, parseAlg;
        class Cube4 {
          constructor(other) {
            var x;
            if (other != null) {
              this.init(other);
            } else {
              this.identity();
            }
            this.newCenter = (function() {
              var k, results;
              results = [];
              for (x = k = 0; k <= 5; x = ++k) {
                results.push(0);
              }
              return results;
            })();
            this.newCp = (function() {
              var k, results;
              results = [];
              for (x = k = 0; k <= 7; x = ++k) {
                results.push(0);
              }
              return results;
            })();
            this.newEp = (function() {
              var k, results;
              results = [];
              for (x = k = 0; k <= 11; x = ++k) {
                results.push(0);
              }
              return results;
            })();
            this.newCo = (function() {
              var k, results;
              results = [];
              for (x = k = 0; k <= 7; x = ++k) {
                results.push(0);
              }
              return results;
            })();
            this.newEo = (function() {
              var k, results;
              results = [];
              for (x = k = 0; k <= 11; x = ++k) {
                results.push(0);
              }
              return results;
            })();
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
            this.co = (function() {
              var k, results;
              results = [];
              for (x = k = 0; k <= 7; x = ++k) {
                results.push(0);
              }
              return results;
            })();
            this.ep = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
            return this.eo = (function() {
              var k, results;
              results = [];
              for (x = k = 0; k <= 11; x = ++k) {
                results.push(0);
              }
              return results;
            })();
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
            result = (function() {
              var k2, len3, ref, results;
              ref = parseAlg(arg);
              results = [];
              for (k2 = 0, len3 = ref.length; k2 < len3; k2++) {
                move = ref[k2];
                face = move / 3 | 0;
                power = move % 3;
                results.push(face * 3 + -(power - 1) + 1);
              }
              return results;
            })();
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
        Cube4.prototype.randomize = (function() {
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
            seen = (function() {
              var k2, ref2, results;
              results = [];
              for (x = k2 = 0, ref2 = arr.length - 1; 0 <= ref2 ? k2 <= ref2 : k2 >= ref2; x = 0 <= ref2 ? ++k2 : --k2) {
                results.push(false);
              }
              return results;
            })();
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
        })();
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
      }).call(this);
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
        our = (function() {
          var m, ref, results;
          results = [];
          for (i = m = 0, ref = maxOur; 0 <= ref ? m <= ref : m >= ref; i = 0 <= ref ? ++m : --m) {
            results.push(0);
          }
          return results;
        })();
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
      mergeURtoDF = (function() {
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
      })();
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
          tables = (function() {
            var results;
            results = [];
            for (name in moveTableParams) {
              results.push(name);
            }
            return results;
          })();
        }
        for (m = 0, len = tables.length; m < len; m++) {
          tableName = tables[m];
          if (this.moveTables[tableName] !== null) {
            continue;
          }
          if (tableName === "mergeURtoDF") {
            this.moveTables.mergeURtoDF = (function() {
              var UBtoDF, URtoUL, o, results;
              results = [];
              for (URtoUL = o = 0; o <= 335; URtoUL = ++o) {
                results.push((function() {
                  var p, results1;
                  results1 = [];
                  for (UBtoDF = p = 0; p <= 335; UBtoDF = ++p) {
                    results1.push(mergeURtoDF(URtoUL, UBtoDF));
                  }
                  return results1;
                })());
              }
              return results;
            })();
          } else {
            [scope, size] = moveTableParams[tableName];
            this.moveTables[tableName] = computeMoveTable(scope, tableName, size);
          }
        }
        return this;
      };
      allMoves1 = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17];
      nextMoves1 = (function() {
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
      })();
      allMoves2 = [0, 1, 2, 4, 7, 9, 10, 11, 13, 16];
      nextMoves2 = (function() {
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
      })();
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
        table = (function() {
          var m2, ref2, results;
          results = [];
          for (x = m2 = 0, ref2 = Math.ceil(size / 8) - 1; 0 <= ref2 ? m2 <= ref2 : m2 >= ref2; x = 0 <= ref2 ? ++m2 : --m2) {
            results.push(4294967295);
          }
          return results;
        })();
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
          tables = (function() {
            var results;
            results = [];
            for (name in pruningTableParams) {
              results.push(name);
            }
            return results;
          })();
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
        moveNames = (function() {
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
        })();
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
        freeStates = (function() {
          var m, ref, results;
          results = [];
          for (x = m = 0, ref = maxDepth + 1; 0 <= ref ? m <= ref : m >= ref; x = 0 <= ref ? ++m : --m) {
            results.push(new State());
          }
          return results;
        })();
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
var frozenRows = (rows) => Object.freeze(rows.map((row) => Object.freeze([...row])));
var CORNER_FACELET = frozenRows([
  [8, 9, 20],
  [6, 18, 38],
  [0, 36, 47],
  [2, 45, 11],
  [29, 26, 15],
  [27, 44, 24],
  [33, 53, 42],
  [35, 17, 51]
]);
var EDGE_FACELET = frozenRows([
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
]);
var CORNER_COLOR = Object.freeze(
  CORNER_FACELET.map((t) => Object.freeze(t.map((i) => SOLVED[i])))
);
var EDGE_COLOR = Object.freeze(
  EDGE_FACELET.map((t) => Object.freeze(t.map((i) => SOLVED[i])))
);
var ROT90 = [6, 3, 0, 7, 4, 1, 8, 5, 2];
function rotateFace(a, k) {
  let out = a.slice();
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
  for (const f of FACES) Object.freeze(out[f]);
  return Object.freeze(out);
})();
var CENTER_INDEX = Object.freeze({
  U: 4,
  R: 13,
  F: 22,
  D: 31,
  L: 40,
  B: 49
});
function decodeFacelets(f) {
  if (f.length !== 54) return null;
  const corners = decodeCorners(f);
  const edges = corners && decodeEdges(f);
  return corners && edges ? { ...corners, ...edges } : null;
}
function decodeCorners(f) {
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
  return { cp, co };
}
function decodeEdges(f) {
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
  return { ep, eo };
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

// src/scheme.ts
var COLOURS = [0, 1, 2, 3, 4, 5];
var COLOUR_NAMES = [
  "white",
  "red",
  "green",
  "yellow",
  "orange",
  "blue"
];
var SCHEMES = ["western", "japanese"];
var SCHEME_COLOURS = Object.freeze({
  western: Object.freeze({ U: 0, R: 1, F: 2, D: 3, L: 4, B: 5 }),
  japanese: Object.freeze({ U: 0, R: 1, F: 2, D: 5, L: 4, B: 3 })
});
function colourOf(position, scheme) {
  return SCHEME_COLOURS[scheme][position];
}
function positionOf(colour, scheme) {
  const table = SCHEME_COLOURS[scheme];
  for (const position of FACES) if (table[position] === colour) return position;
  throw new Error(`scheme ${scheme} paints no position ${colour}`);
}
function slotOf(colour) {
  return FACES[colour];
}
function colourOfSlot(slot) {
  return FACES.indexOf(slot);
}
function isColour(centre) {
  return Number.isInteger(centre) && centre >= 0 && centre < COLOURS.length;
}
function neighbourColours(colour, scheme) {
  const around = FACE_NEIGHBOURS[positionOf(colour, scheme)];
  return ["top", "right", "bottom", "left"].map(
    (side) => colourOf(around[side], scheme)
  );
}
function adjacentIn(a, b, scheme) {
  return neighbourColours(a, scheme).includes(b);
}
function commonNeighbours(colour, schemes) {
  return COLOURS.filter((c) => c !== colour && schemes.every((s) => adjacentIn(colour, c, s)));
}
function holdOffset(colour, up, scheme) {
  const around = neighbourColours(colour, scheme);
  const side = around.indexOf(up);
  if (side < 0) return null;
  return (4 - side) % 4;
}
function heldUpColour(colour, rotation, scheme) {
  return neighbourColours(colour, scheme)[(rotation % 4 + 4) % 4];
}
function schemeOfCentres(centres) {
  return SCHEMES.find((scheme) => FACES.every((p) => centres[p] === colourOf(p, scheme)));
}
function neighbourColour(colour, side, scheme) {
  return colourOf(FACE_NEIGHBOURS[positionOf(colour, scheme)][side], scheme);
}

// src/misread-decode.ts
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
function slotMinima(tensor) {
  return tensor.map((slot) => {
    let best = Number.POSITIVE_INFINITY;
    for (const ori of slot) for (const d of ori) if (d < best) best = d;
    return best;
  });
}
function lowerBound(t) {
  let lb = 0;
  for (const best of slotMinima(t.corner)) lb += best;
  for (const best of slotMinima(t.edge)) lb += best;
  return lb;
}
function assignments(tensor, n, budget, counter) {
  const rowMin = slotMinima(tensor);
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
function writeCubies(out, slots, colours, a) {
  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i];
    const cubie = colours[a.cubie[i]];
    for (let p = 0; p < slot.length; p++) out[slot[p]] = cubie[(p + a.ori[i]) % slot.length];
  }
}
function realise(t, corners, edges, base) {
  const out = [...base];
  writeCubies(out, CORNER_FACELET, t.cornerColors, corners);
  writeCubies(out, EDGE_FACELET, t.edgeColors, edges);
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
function priceRotations(faces, canon, maxDistance, fixedRotation) {
  const candidates = [];
  const combos = fixedRotation ? 1 : 4096;
  for (let combo = 0; combo < combos; combo++) {
    const rotations = [0, 1, 2, 3, 4, 5].map((i) => combo >> 2 * i & 3);
    const bound = lowerBound(buildTensors(flatten(faces, rotations), canon));
    if (bound <= maxDistance) candidates.push({ rotations, bound });
  }
  return candidates;
}
function repairsAt(budget, candidates, faces, canon, centreOwner, counter) {
  const found = [];
  for (const { rotations, bound } of candidates) {
    if (bound > budget) continue;
    const observed = flatten(faces, rotations);
    const tensors = buildTensors(observed, canon);
    const corners = assignments(tensors.corner, 8, budget, counter);
    if (corners === null) return null;
    const edges = assignments(tensors.edge, 12, budget, counter);
    if (edges === null) return null;
    for (const c of corners) {
      for (const e of edges) {
        if (++counter.nodes > counter.limit) return null;
        if (c.total + e.total !== budget) continue;
        const repaired = realise(tensors, c, e, observed);
        if (isLegal(repaired, centreOwner)) found.push({ rotations, observed, repaired });
      }
    }
  }
  return found;
}
function aggregate(found, budget) {
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
function decodeMisread(faces, centreOwner, options = {}) {
  const maxDistance = whole("maxDistance", options.maxDistance, DEFAULT_MAX_DISTANCE);
  const counter = { nodes: 0, limit: whole("nodeBudget", options.nodeBudget, DEFAULT_NODE_BUDGET) };
  const faceCentre = FACES.map((f) => faces[f].colors[4]);
  const canon = canonicalColors(faceCentre);
  const candidates = priceRotations(faces, canon, maxDistance, options.fixedRotation === true);
  for (let budget = 0; budget <= maxDistance; budget++) {
    const found = repairsAt(budget, candidates, faces, canon, centreOwner, counter);
    if (found === null) return { kind: "unknown" };
    if (found.length === 0) continue;
    return aggregate(found, budget);
  }
  return { kind: "beyond", distance: maxDistance };
}
function diagnoseMisread(faces, options = {}) {
  let decoded;
  try {
    const centreOwner = /* @__PURE__ */ new Map();
    for (const face of FACES) centreOwner.set(faces[face].colors[4], face);
    if (centreOwner.size !== FACES.length) return {};
    decoded = decodeMisread(faces, centreOwner, options);
  } catch (err) {
    console.error("[cubus] misread diagnosis failed, so nothing is claimed about the scan", err);
    return {};
  }
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
function diagnoseAcrossSchemes(bySlot, options = {}, schemes = SCHEMES) {
  const given = options.maxDistance;
  if (given !== void 0 && (!Number.isInteger(given) || given < 0)) {
    return diagnoseAtCap(bySlot, options, schemes);
  }
  const cap = given ?? DEFAULT_MAX_DISTANCE;
  let answer = {};
  for (let d = 0; d <= cap; d++) {
    answer = diagnoseAtCap(bySlot, { ...options, maxDistance: d }, schemes);
    if (typeof answer.misreadCount !== "number") return answer;
    if (answer.misreadCount <= d) return answer;
  }
  return answer;
}
function diagnoseAtCap(bySlot, options, schemes) {
  const toSlot = (position, scheme) => slotOf(colourOf(position, scheme));
  const results = [];
  for (const scheme of schemes) {
    const faces = {};
    for (const slot of FACES) faces[positionOf(colourOfSlot(slot), scheme)] = bySlot[slot];
    const d = diagnoseMisread(faces, options);
    if (typeof d.misreadCount !== "number") return {};
    results.push({
      scheme,
      diagnosis: {
        misreadCount: d.misreadCount,
        ...d.suspects ? { suspects: d.suspects.map((s) => ({ ...s, face: toSlot(s.face, scheme) })) } : {},
        ...d.misreadFace ? { misreadFace: toSlot(d.misreadFace, scheme) } : {}
      }
    });
  }
  if (results.length === 0) return {};
  const floor = Math.min(...results.map((r) => r.diagnosis.misreadCount));
  const best = results.filter((r) => r.diagnosis.misreadCount === floor);
  if (best.length === 1) return { ...best[0].diagnosis, misreadScheme: best[0].scheme };
  const same = (pick) => {
    const values = best.map((r) => JSON.stringify(pick(r.diagnosis) ?? null));
    return values.every((v) => v === values[0]) ? pick(best[0].diagnosis) : void 0;
  };
  const suspects = same((d) => d.suspects);
  const misreadFace = same((d) => d.misreadFace);
  return {
    misreadCount: floor,
    ...suspects && suspects.length > 0 ? { suspects } : {},
    ...misreadFace ? { misreadFace } : {}
  };
}

// src/nine-of-each.ts
var NUM_COLORS = 6;
var PER_COLOR = 9;
var STICKERS = NUM_COLORS * PER_COLOR;
var LOG_FLOOR = 1e-9;
var logp = (p) => Math.log(Math.max(p, LOG_FLOOR));
function assignNineOfEach(scores) {
  if (scores.length !== STICKERS) {
    throw new Error(`expected ${STICKERS} stickers, got ${scores.length}`);
  }
  for (const [i, row] of scores.entries()) {
    if (row.length !== NUM_COLORS)
      throw new Error(`sticker ${i} has ${row.length} scores, expected ${NUM_COLORS}`);
    for (const v of row) {
      if (!Number.isFinite(v) || v < 0)
        throw new Error(`sticker ${i} has a non-finite or negative score`);
    }
  }
  const cost = scores.map((row) => {
    const out = new Array(STICKERS);
    for (let c = 0; c < NUM_COLORS; c++) {
      const v = -logp(row[c]);
      for (let k = 0; k < PER_COLOR; k++) out[c * PER_COLOR + k] = v;
    }
    return out;
  });
  const slotOf2 = hungarian(cost);
  const colors = slotOf2.map((slot) => Math.floor(slot / PER_COLOR));
  const argmax = scores.map((row) => {
    let best = 0;
    for (let c = 1; c < NUM_COLORS; c++) if (row[c] > row[best]) best = c;
    return best;
  });
  const changed = colors.map((_, i) => i).filter((i) => colors[i] !== argmax[i]);
  let cost_ = 0;
  for (let i = 0; i < STICKERS; i++)
    cost_ += logp(scores[i][argmax[i]]) - logp(scores[i][colors[i]]);
  return { colors, changed, cost: Math.max(0, cost_) };
}
function hungarian(cost) {
  const n = cost.length;
  const u = new Float64Array(n + 1);
  const v = new Float64Array(n + 1);
  const p = new Int32Array(n + 1).fill(0);
  const way = new Int32Array(n + 1).fill(0);
  for (let i = 1; i <= n; i++) {
    p[0] = i;
    let j0 = 0;
    const minv = new Float64Array(n + 1).fill(Infinity);
    const used = new Uint8Array(n + 1);
    do {
      used[j0] = 1;
      const i0 = p[j0];
      let delta = Infinity;
      let j1 = 0;
      for (let j = 1; j <= n; j++) {
        if (used[j]) continue;
        const cur = cost[i0 - 1][j - 1] - u[i0] - v[j];
        if (cur < minv[j]) {
          minv[j] = cur;
          way[j] = j0;
        }
        if (minv[j] < delta) {
          delta = minv[j];
          j1 = j;
        }
      }
      for (let j = 0; j <= n; j++) {
        if (used[j]) {
          u[p[j]] = u[p[j]] + delta;
          v[j] = v[j] - delta;
        } else {
          minv[j] = minv[j] - delta;
        }
      }
      j0 = j1;
    } while (p[j0] !== 0);
    do {
      const j1 = way[j0];
      p[j0] = p[j1];
      j0 = j1;
    } while (j0);
  }
  const col = new Array(n);
  for (let j = 1; j <= n; j++) col[p[j] - 1] = j - 1;
  return col;
}

// src/paint-groups.ts
var ROUNDS = 25;
var MAX_RATIO = 0.7;
function groupByPaint(lab) {
  if (lab.length !== STICKERS) return null;
  const ab = [];
  for (const row of lab) {
    if (row.length !== 3 || !row.every((v) => Number.isFinite(v))) return null;
    ab.push([row[1], row[2]]);
  }
  const mean = [
    ab.reduce((s, p) => s + p[0], 0) / ab.length,
    ab.reduce((s, p) => s + p[1], 0) / ab.length
  ];
  const seeds = [ab[argmaxBy(ab, (p) => squared(p, mean))]];
  while (seeds.length < NUM_COLORS) {
    seeds.push(ab[argmaxBy(ab, (p) => Math.min(...seeds.map((s) => squared(p, s))))]);
  }
  let centres = seeds;
  let groups = null;
  for (let round = 0; round < ROUNDS; round++) {
    const cost = ab.map((p) => {
      const row = new Array(STICKERS);
      for (let c = 0; c < NUM_COLORS; c++) {
        const d = squared(p, centres[c]);
        for (let k = 0; k < PER_COLOR; k++) row[c * PER_COLOR + k] = d;
      }
      return row;
    });
    const next = hungarian(cost).map((slot) => Math.floor(slot / PER_COLOR));
    if (groups && next.every((g, i) => g === groups[i])) break;
    groups = next;
    centres = centres.map((_, c) => {
      const members = ab.filter((_2, i) => groups[i] === c);
      return [
        members.reduce((s, p) => s + p[0], 0) / members.length,
        members.reduce((s, p) => s + p[1], 0) / members.length
      ];
    });
  }
  return groups;
}
function colorsFromPaint(lab, centres, maxRatio = MAX_RATIO) {
  if (centres.length !== NUM_COLORS) return null;
  if (!centres.every((c) => Number.isInteger(c) && c >= 0 && c < NUM_COLORS)) return null;
  if (new Set(centres).size !== NUM_COLORS) return null;
  const groups = groupByPaint(lab);
  if (!groups) return null;
  if (!wellSeparated(lab, groups, maxRatio)) return null;
  const naming = new Array(NUM_COLORS).fill(-1);
  for (let face = 0; face < NUM_COLORS; face++) {
    const group = groups[face * PER_COLOR + 4];
    if (naming[group] !== -1) return null;
    naming[group] = centres[face];
  }
  return groups.map((g) => naming[g]);
}
function wellSeparated(lab, groups, maxRatio) {
  const ab = lab.map((row) => [row[1], row[2]]);
  const centres = [];
  for (let c = 0; c < NUM_COLORS; c++) {
    const members = ab.filter((_, i) => groups[i] === c);
    if (members.length === 0) return false;
    centres.push([
      members.reduce((s, q) => s + q[0], 0) / members.length,
      members.reduce((s, q) => s + q[1], 0) / members.length
    ]);
  }
  for (const [i, point] of ab.entries()) {
    const own = Math.sqrt(squared(point, centres[groups[i]]));
    let nearest = Number.POSITIVE_INFINITY;
    for (let c = 0; c < NUM_COLORS; c++) {
      if (c !== groups[i]) nearest = Math.min(nearest, Math.sqrt(squared(point, centres[c])));
    }
    if (!(own < maxRatio * nearest)) return false;
  }
  return true;
}
function squared(a, b) {
  return (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2;
}
function argmaxBy(items, value) {
  let best = 0;
  for (let i = 1; i < items.length; i++) if (value(items[i]) > value(items[best])) best = i;
  return best;
}

// src/ai-assemble.ts
function looksAt(confirmed, slot) {
  const looks = confirmed[slot];
  if (looks === void 0) return [];
  return Array.isArray(looks) ? looks : [looks];
}
var CONFIRM_TOLERANCE = 2;
var LOW_CONFIDENCE_THRESHOLD = 0.15;
var UP_PREFERENCE = [0, 2, 1, 4, 3, 5];
function cubejsRoundTrips(facelets) {
  try {
    return import_cubejs2.default.fromString(facelets).asString() === facelets;
  } catch {
    return false;
  }
}
function reject(reason, extra = {}) {
  return { facelets: "", valid: false, reason, ...extra };
}
function matchingRotations(original, confirmed) {
  if (original.colors[4] !== confirmed.colors[4]) return /* @__PURE__ */ new Set();
  const dist = [0, 1, 2, 3].map(
    (k) => rotateFace(original.colors, k).reduce((s, c, i) => s + (c === confirmed.colors[i] ? 0 : 1), 0)
  );
  return new Set([0, 1, 2, 3].filter((k) => dist[k] <= CONFIRM_TOLERANCE));
}
var SAME_SIDE_STICKERS = 7;
function sameSide(a, b, atLeast = SAME_SIDE_STICKERS) {
  for (let k = 0; k < 4; k++) {
    const turned = rotateFace(b, k);
    let agree = 0;
    for (let i = 0; i < 9; i++) if (i !== 4 && turned[i] === a[i]) agree += 1;
    if (agree >= atLeast) return true;
  }
  return false;
}
var SAME_SIDE_BY_CENTRE = 5;
function byPosition(bySlot, scheme) {
  const out = {};
  for (const slot of FACES) out[positionOf(colourOfSlot(slot), scheme)] = bySlot[slot];
  return out;
}
function comboToSlots(combo, scheme) {
  return FACES.map((slot) => combo[FACES.indexOf(positionOf(colourOfSlot(slot), scheme))]);
}
var readingsOf = (candidates) => new Set(candidates.map((c) => c.facelets));
var schemesOf = (candidates) => SCHEMES.filter((s) => candidates.some((c) => c.scheme === s));
function undeterminedSlots(candidates) {
  return FACES.filter((slot, si) => {
    const perCandidate = candidates.map((c) => holdsOf(c, slot, si).join(","));
    return new Set(perCandidate).size > 1;
  });
}
function holdsOf(candidate, slot, si) {
  const colour = colourOfSlot(slot);
  return [
    ...new Set(candidate.combos.map((combo) => heldUpColour(colour, combo[si], candidate.scheme)))
  ].sort();
}
function permittedHold(slot, schemes, confirmed = {}) {
  const colour = colourOfSlot(slot);
  const used = new Set(looksAt(confirmed, slot).map((look) => colourOfSlot(look.up)));
  const allowed = commonNeighbours(colour, schemes).filter((c) => !used.has(c));
  const tops = new Set(schemes.map((s) => neighbourColour(colour, "top", s)));
  const canonical = tops.size === 1 ? [...tops][0] : void 0;
  const up = canonical !== void 0 && allowed.includes(canonical) ? canonical : UP_PREFERENCE.find((c) => allowed.includes(c));
  return up === void 0 ? void 0 : { face: slot, up: slotOf(up) };
}
var MAX_LOOKS_PER_SLOT = 2;
function mayLookAgain(slot, confirmed, effective, schemes) {
  const given = looksAt(confirmed, slot);
  if (given.length === 0) return true;
  if (given.length >= MAX_LOOKS_PER_SLOT || !effective.has(slot)) return false;
  const first = permittedHold(slot, schemes);
  return first !== void 0 && given[0].up === first.up;
}
function pickConfirm(candidates, confirmed, effective) {
  const schemes = schemesOf(candidates);
  const holds = undeterminedSlots(candidates).filter((slot) => mayLookAgain(slot, confirmed, effective, schemes)).map((slot) => permittedHold(slot, schemes, confirmed)).filter((h) => h !== void 0);
  const fresh = holds.filter((h) => looksAt(confirmed, h.face).length === 0);
  const pool = fresh.length > 0 ? fresh : holds;
  return pool.find((h) => h.up === "U") ?? pool[0];
}
function contradictedByEveryLook(exposed, given, si) {
  if (exposed.length === 0) return false;
  return exposed.every(
    (w) => given.some((look) => w.combos.every((c) => !look.get(w.scheme).has(c[si])))
  );
}
function pickVerification(survivors, weak, narrowed, confirmed, schemes) {
  const exposedAt = (slot, si) => {
    const ours = new Set(survivors.flatMap((s) => holdsOf(s, slot, si)));
    return weak.filter((w) => holdsOf(w, slot, si).every((up) => !ours.has(up)));
  };
  const pick = (slots) => {
    let best;
    let bestScore = 0;
    for (const slot of slots) {
      const hold = permittedHold(slot, schemes, confirmed);
      if (!hold) continue;
      const score = exposedAt(slot, FACES.indexOf(slot)).length + (hold.up === "U" ? 0.5 : 0);
      if (score > bestScore) {
        bestScore = score;
        best = hold;
      }
    }
    return best === void 0 || bestScore < 1 ? void 0 : best;
  };
  const fresh = FACES.filter((slot) => (narrowed.looks.get(slot) ?? []).length === 0);
  const first = pick(fresh);
  if (first) return first;
  const again = FACES.filter((slot, si) => {
    const given = narrowed.looks.get(slot) ?? [];
    if (given.length === 0 || !mayLookAgain(slot, confirmed, narrowed.effective, schemes)) {
      return false;
    }
    return contradictedByEveryLook(exposedAt(slot, si), given, si);
  });
  return pick(again);
}
function solvableReadings(bySlot, scheme) {
  const faces = byPosition(bySlot, scheme);
  const owner = /* @__PURE__ */ new Map();
  for (const position of FACES) owner.set(faces[position].colors[4], position);
  const buildFacelets = (rots2) => {
    const letters = [];
    for (let fi = 0; fi < 6; fi++) {
      const rc = rotateFace(faces[FACES[fi]].colors, rots2[fi]);
      for (let i = 0; i < 9; i++) {
        const position = owner.get(rc[i]);
        if (position === void 0) return null;
        letters.push(position);
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
    if (combos !== null) combos.push(comboToSlots(rots, scheme));
  }
  return [...seen].filter((e) => e[1] !== null).map(([facelets, combos]) => ({ scheme, facelets, combos }));
}
function checkedCapture(label, f) {
  if (!f || !Array.isArray(f.colors) || f.colors.length !== 9 || !Array.isArray(f.confidence) || f.confidence.length !== 9) {
    throw new Error(`${label}: expected 9 colours + 9 confidences`);
  }
  for (const c of f.confidence) {
    if (!Number.isFinite(c) || c < 0 || c > 1) {
      throw new Error(`${label}: confidence ${c} is not a number in [0, 1]`);
    }
  }
  return f;
}
function checkedCentres(faces) {
  const centres = /* @__PURE__ */ new Map();
  const seen = /* @__PURE__ */ new Set();
  for (const key of FACES) {
    const f = checkedCapture(`face ${key}`, faces[key]);
    const centre = f.colors[4];
    if (!isColour(centre)) {
      return reject(`face ${key} has centre colour ${centre}, which is not one of the six`);
    }
    if (seen.has(centre)) return reject(`two faces share centre colour ${centre}`);
    seen.add(centre);
    centres.set(key, centre);
  }
  return centres;
}
function checkedBySlot(faces) {
  const centres = checkedCentres(faces);
  if (!(centres instanceof Map)) return centres;
  for (const [slot, centre] of centres) {
    if (slotOf(centre) !== slot) {
      return reject(
        `face ${slot} has centre colour ${centre}, which files under ${slotOf(centre)} \u2014 a slot names a colour, not a position`
      );
    }
  }
  return faces;
}
function buildCentreOwner(faces) {
  const centres = checkedCentres(faces);
  if (!(centres instanceof Map)) return centres;
  return new Map([...centres].map(([position, centre]) => [centre, position]));
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
function assemblePainted(faces, threshold = LOW_CONFIDENCE_THRESHOLD, options = {}) {
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
    const diagnosis = options.diagnose === false ? { misreadCount: null } : diagnoseMisread(faces, { fixedRotation: true });
    return reject("not a solvable cube yet", diagnosis);
  }
  const conf = FACES.flatMap((f) => faces[f].confidence);
  const centres = Object.fromEntries(FACES.map((f) => [f, faces[f].colors[4]]));
  return {
    facelets,
    valid: true,
    ...summariseConfidence(conf, threshold),
    ...schemeOfCentres(centres) ? { scheme: schemeOfCentres(centres) } : {}
  };
}
function allowedByLook(slot, look, label, bySlot, originals) {
  const checked = checkedCapture(label, look.capture);
  const { up } = look;
  if (!FACES.includes(up)) throw new Error(`${label}: up ${String(up)} is not a slot`);
  const physical = /* @__PURE__ */ new Set([
    ...matchingRotations(bySlot[slot], checked),
    ...matchingRotations(originals[slot], checked)
  ]);
  if (physical.size === 0) return null;
  const perScheme = /* @__PURE__ */ new Map();
  for (const scheme of SCHEMES) {
    const offset = holdOffset(colourOfSlot(slot), colourOfSlot(up), scheme);
    perScheme.set(
      scheme,
      offset === null ? /* @__PURE__ */ new Set() : new Set([...physical].map((k) => (k - offset + 4) % 4))
    );
  }
  return perScheme;
}
function intersectLooks(perLook) {
  const together = /* @__PURE__ */ new Map();
  for (const scheme of SCHEMES) {
    together.set(
      scheme,
      new Set([0, 1, 2, 3].filter((r) => perLook.every((look) => look.get(scheme).has(r))))
    );
  }
  return together;
}
function narrowByConfirmations(bySlot, originals, all, confirmed) {
  const confirmedSlots = FACES.filter((slot) => looksAt(confirmed, slot).length > 0);
  const allowed = /* @__PURE__ */ new Map();
  const looks = /* @__PURE__ */ new Map();
  for (const slot of confirmedSlots) {
    const perLook = [];
    for (const [n, look] of looksAt(confirmed, slot).entries()) {
      const label = n === 0 ? `confirmation of ${slot}` : `confirmation ${n + 1} of ${slot}`;
      const byLook = allowedByLook(slot, look, label, bySlot, originals);
      if (byLook === null) {
        return {
          ok: false,
          refusal: reject(
            "that side read differently this time \u2014 checking again with the fresh read",
            { reread: slot, rereadLook: n, confirm: { face: slot, up: look.up } }
          )
        };
      }
      perLook.push(byLook);
    }
    looks.set(slot, perLook);
    allowed.set(slot, intersectLooks(perLook));
  }
  const effective = /* @__PURE__ */ new Set();
  const candidates = all.map(
    (c) => ({
      ...c,
      // EVERY confirmed slot is asked about every combo, and only then are the answers combined
      // (2026-09-20): an `every` that stopped at the first refusing slot never asked the slots
      // after it, so a slot whose look also refused the combo was not recorded as `effective` —
      // the record this set exists to keep, and the one `mayLookAgain` reads.
      combos: c.combos.filter(
        (combo) => confirmedSlots.map((slot) => {
          const kept = allowed.get(slot).get(c.scheme).has(combo[FACES.indexOf(slot)]);
          if (!kept) effective.add(slot);
          return kept;
        }).every(Boolean)
      )
    })
  ).filter((c) => c.combos.length > 0);
  if (candidates.length === 0) {
    const last = confirmedSlots[confirmedSlots.length - 1];
    const lastLooks = looksAt(confirmed, last);
    return {
      ok: false,
      refusal: reject("those two looks disagree \u2014 one was held the wrong way up; try again", {
        mismatch: true,
        confirm: { face: last, up: lastLooks[lastLooks.length - 1].up }
      })
    };
  }
  return { ok: true, confirmedSlots, allowed, looks, effective, candidates };
}
function verifySurvivor(all, survivors, narrowed, confirmed) {
  const { confirmedSlots, looks } = narrowed;
  const facelets = survivors[0].facelets;
  const contradictions = (candidate) => confirmedSlots.reduce((n, slot) => {
    const si = FACES.indexOf(slot);
    return n + looks.get(slot).filter((look) => candidate.combos.every((c) => !look.get(candidate.scheme).has(c[si]))).length;
  }, 0);
  const weak = all.filter((c) => c.facelets !== facelets && contradictions(c) < 2);
  if (weak.length === 0) return null;
  const schemes = schemesOf([...survivors, ...weak]);
  const check = pickVerification(survivors, weak, narrowed, confirmed, schemes);
  if (check) {
    return reject("one more look to be sure \u2014 a single look could be held wrong", {
      confirm: check
    });
  }
  return symmetricRefusal(survivors, weak);
}
function symmetricRefusal(survivors, alternatives) {
  const survivorSchemes = new Set(survivors.map((c) => c.scheme));
  const onlyScheme = alternatives.length > 0 && alternatives.every((c) => !survivorSchemes.has(c.scheme));
  if (onlyScheme) {
    return reject(
      "these readings differ only in which colour is under white, and no hold can tell them apart \u2014 turn any one face, then scan again",
      { ambiguous: true, schemeAmbiguous: true }
    );
  }
  return reject(
    "this cube is too symmetric to read for certain \u2014 turn any one face, then scan again",
    { ambiguous: true }
  );
}
var MAX_REPAIR_COST = 12;
function movesALockedSticker(faces, colors) {
  return FACES.some(
    (face, fi) => (faces[face]?.locked ?? []).some(
      (on, k) => on && colors[fi * 9 + k] !== faces[face].colors[k]
    )
  );
}
function reobserved(repaired, original, looks, indices) {
  if (indices.length === 0) return true;
  for (const look of looks) {
    const rotations = /* @__PURE__ */ new Set([
      ...matchingRotations(repaired, look.capture),
      ...matchingRotations(original, look.capture)
    ]);
    for (const k of rotations) {
      const asCaptured = rotateFace(look.capture.colors, -k);
      if (indices.every((i) => asCaptured[i] === repaired.colors[i])) return true;
    }
  }
  return false;
}
function mostRepaired(changed) {
  let best = changed[0].face;
  let most = 0;
  for (const face of FACES) {
    const n = changed.filter((s) => s.face === face).length;
    if (n > most) {
      most = n;
      best = face;
    }
  }
  return best;
}
function repairByCounts(faces, maxCost) {
  const scores = [];
  for (const face of FACES) {
    const s = faces[face]?.scores;
    if (s?.length !== 9 || s.some((row) => row.length !== NUM_COLORS)) return null;
    for (const row of s) scores.push(row);
  }
  if (scores.length !== STICKERS) return null;
  let result;
  try {
    result = assignNineOfEach(scores);
  } catch {
    return null;
  }
  if (result.changed.length === 0 || result.cost > maxCost) return null;
  if (!(result.cost > 0)) return null;
  if (movesALockedSticker(faces, result.colors)) return null;
  const out = {};
  FACES.forEach((face, i) => {
    out[face] = {
      ...faces[face],
      colors: result.colors.slice(i * 9, i * 9 + 9)
    };
  });
  return {
    faces: out,
    // WHICH stickers were invented, named where a person can find them.
    //
    // MEASURED AGAINST THE CAPTURE, NOT AGAINST THE SCORES' ARGMAX, and the difference is not a
    // detail. `assignNineOfEach.changed` reports where the assignment differs from each sticker's
    // top score — which includes every sticker a CALLER had already decided on other evidence: a
    // capture whose centre was rewritten to its slot's colour (`withCentre`) would count as
    // "repaired" at the argmax and D1 would demand a second look at a colour the repair never
    // touched. What D1 is about is a sticker whose colour NOBODY observed, so the comparison is
    // with the colour the capture carries.
    changed: result.changed.flatMap((at) => {
      const face = FACES[Math.floor(at / 9)];
      const index = at % 9;
      const from = faces[face].colors[index];
      const to = result.colors[at];
      return from === to ? [] : [{ face, index, from, to }];
    })
  };
}
function recolourByPaint(faces) {
  const lab = [];
  const centres = [];
  for (const face of FACES) {
    const capture = faces[face];
    if (capture?.lab?.length !== 9) return null;
    for (const row of capture.lab) lab.push(row);
    centres.push(capture.colors[4]);
  }
  const colors = colorsFromPaint(lab, centres);
  if (!colors || movesALockedSticker(faces, colors)) return null;
  const out = {};
  FACES.forEach((face, i) => {
    out[face] = { ...faces[face], colors: colors.slice(i * 9, i * 9 + 9) };
  });
  return out;
}
function withCentre(capture, colour) {
  if (capture.colors[4] === colour) return capture;
  const colors = [...capture.colors];
  colors[4] = colour;
  if (!capture.scores) return { ...capture, colors };
  const scores = capture.scores.map((row) => [...row]);
  scores[4] = scores[4].map((_, c) => c === colour ? 1 : 0);
  return { ...capture, colors, scores };
}
function assembleColors(faces, threshold = LOW_CONFIDENCE_THRESHOLD, confirmed = {}, options = {}) {
  return assembleWithin(faces, threshold, confirmed, options);
}
function assembleWithin(faces, threshold, confirmed, options, allowPaint = true, originals) {
  const bySlot = checkedBySlot(faces);
  if ("valid" in bySlot) return bySlot;
  const asRead = originals ?? bySlot;
  const couldAccept = (candidate) => {
    const bySlotCandidate = checkedBySlot(candidate);
    if ("valid" in bySlotCandidate) return false;
    return SCHEMES.some((scheme) => solvableReadings(bySlotCandidate, scheme).length > 0);
  };
  const accept = (candidate) => {
    if (!candidate) return null;
    const bySlotCandidate = checkedBySlot(candidate);
    if ("valid" in bySlotCandidate) return null;
    const solvable = SCHEMES.flatMap((scheme) => solvableReadings(bySlotCandidate, scheme));
    if (solvable.length === 0) return null;
    return assembleWithin(candidate, threshold, confirmed, options, allowPaint, asRead);
  };
  const all = SCHEMES.flatMap((scheme) => solvableReadings(bySlot, scheme));
  if (all.length === 0) {
    const repair = repairByCounts(faces, MAX_REPAIR_COST);
    const unseen = repair ? repair.changed.filter(
      (s) => !reobserved(
        repair.faces[s.face],
        faces[s.face],
        looksAt(confirmed, s.face),
        repair.changed.filter((r) => r.face === s.face).map((r) => r.index)
      )
    ) : [];
    const byCounts = repair && unseen.length === 0 ? accept(repair.faces) : null;
    if (byCounts) return byCounts;
    if (repair && unseen.length > 0 && couldAccept(repair.faces)) {
      const worst = mostRepaired(unseen);
      const hold = looksAt(confirmed, worst).length === 0 ? permittedHold(worst, SCHEMES, confirmed) : void 0;
      if (hold) {
        return reject("a colour needs a second look before this cube can be accepted", {
          confirm: hold,
          repaired: unseen,
          misreadFace: worst
        });
      }
    }
    const byPaint = accept(allowPaint ? recolourByPaint(faces) : null);
    if (byPaint) return byPaint;
    const unproven = FACES.filter((face) => faces[face]?.ordering === "sorted");
    if (unproven.length > 0) {
      return reject(
        // NAMES WHAT WAS MEASURED, and nothing about how the cube was held. "Hold it flatter",
        // "steadier", "centred" are the sentences `apps/web/test/scan-sentences.test.mjs` refuses,
        // because the scanner measures none of them; what it DID measure is that the nine boxes fit
        // no lattice, so their places on the face are not settled.
        "one side\u2019s stickers could not be placed for certain \u2014 show it again",
        // NO `suspects` AND NO COUNT. Both are claims about COLOURS, and neither is earned while a
        // side's stickers may simply be in the wrong places; `misreadFace` names the side to
        // re-show, which is what a host acts on.
        { misreadFace: unproven[0], unprovenOrder: unproven }
      );
    }
    return reject(
      "no orientation of the faces is solvable \u2014 a colour was misread",
      options.diagnose === false ? { misreadCount: null } : diagnoseAcrossSchemes(bySlot)
    );
  }
  const narrowed = narrowByConfirmations(bySlot, asRead, all, confirmed);
  if (!narrowed.ok) return narrowed.refusal;
  const candidates = narrowed.candidates;
  const readings = readingsOf(candidates);
  if (readings.size > 1) {
    const confirm = pickConfirm(candidates, confirmed, narrowed.effective);
    if (confirm) {
      return reject(`${readings.size} readings fit \u2014 another look narrows them`, {
        ambiguous: true,
        confirm,
        readings: readings.size,
        undetermined: undeterminedSlots(candidates)
      });
    }
    const [first] = readings;
    return symmetricRefusal(
      candidates.filter((c) => c.facelets === first),
      candidates.filter((c) => c.facelets !== first)
    );
  }
  const survivors = candidates;
  const unverified = verifySurvivor(all, survivors, narrowed, confirmed);
  if (unverified) return unverified;
  const facelets = survivors[0].facelets;
  const schemes = schemesOf(survivors);
  const chosen = survivors.find((c) => c.scheme === schemes[0]).combos[0];
  const conf = [];
  FACES.forEach((slot, si) => {
    for (const c of rotateFace(bySlot[slot].confidence, chosen[si])) conf.push(c);
  });
  return {
    facelets,
    valid: true,
    scheme: schemes.length === 1 ? schemes[0] : "undetermined",
    ...summariseConfidence(conf, threshold),
    rotations: [...chosen],
    // The captures this reading was built from — repaired when a repair ran — so a host settles
    // what was accepted and not what the camera first read. See `AiScanResult.captures`.
    captures: { ...bySlot }
  };
}

// src/camera.ts
var FrameNotReadyError = class extends Error {
  constructor(reason = "the video has no dimensions yet") {
    super(`camera not ready: ${reason}`);
    this.name = "FrameNotReadyError";
  }
};
var CameraLostError = class extends Error {
  constructor(why) {
    super(`camera lost: ${why}`);
    this.name = "CameraLostError";
  }
};
function frameLiveness(stream, track) {
  if (!track || track.readyState === "ended" || stream?.active === false) return "ended";
  return track.muted === true ? "muted" : "live";
}
function videoFrameId(video) {
  if (video.videoWidth === 0 || video.videoHeight === 0) return null;
  const frames = video.getVideoPlaybackQuality?.().totalVideoFrames;
  return typeof frames === "number" && Number.isFinite(frames) ? frames : null;
}
var IDEAL_WIDTH = 1280;
var IDEAL_HEIGHT = 720;
function facingOf(value) {
  return value === "user" || value === "environment" ? value : void 0;
}
function describeTrack(track) {
  const settings = track?.getSettings();
  const facing = facingOf(settings?.facingMode);
  return {
    deviceId: settings?.deviceId ?? "",
    label: track?.label || "Camera",
    ...facing ? { facing } : {}
  };
}
async function listCameras() {
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices.filter((d) => d.kind === "videoinput").filter((d) => d.deviceId !== "").map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Camera ${i + 1}` }));
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
function videoConstraints(opts) {
  const constraints = {};
  if (opts.deviceId) constraints.deviceId = { exact: opts.deviceId };
  else if (opts.facingMode) constraints.facingMode = opts.facingMode;
  constraints.width = { ideal: opts.width ?? IDEAL_WIDTH };
  constraints.height = { ideal: opts.height ?? IDEAL_HEIGHT };
  return constraints;
}
async function acquireStream(constraints, signal) {
  const asked = navigator.mediaDevices.getUserMedia(constraints);
  if (signal) {
    void asked.then(
      (stream) => {
        if (signal.aborted) for (const track of stream.getTracks()) track.stop();
      },
      () => {
      }
    );
  }
  return raceAbort(asked, signal);
}
function frameSourceOf(video, stream, ctx, canvas, release) {
  const track = stream.getVideoTracks()[0];
  const device = describeTrack(track);
  let endedWhy = null;
  track?.addEventListener("ended", () => {
    endedWhy = "the video track ended";
  });
  const ready = () => {
    if (endedWhy !== null) throw new CameraLostError(endedWhy);
    const liveness = frameLiveness(stream, track);
    if (liveness === "ended") throw new CameraLostError("the camera stopped delivering");
    if (liveness === "muted") throw new FrameNotReadyError("the video track is muted");
    if (video.videoWidth === 0 || video.videoHeight === 0) throw new FrameNotReadyError();
  };
  return {
    device,
    ready,
    /**
     * Which frame the element is showing, as a COUNT of frames it has produced (D2).
     *
     * `getVideoPlaybackQuality().totalVideoFrames` is exactly that: the number of frames created
     * for this element, dropped ones included. It repeats between paints, which is the fact D2
     * needs reported, and it is a counter rather than a clock — so a tick between two paints reads
     * the same value by construction rather than by rounding.
     *
     * NOT `currentTime`, which was the first attempt and is the wrong instrument: for a
     * `MediaStream` the element's position advances with the stream in real time, so reading it
     * per tick would answer "a new frame" on every tick — precisely the false belief D2 exists to
     * correct, restated as its fix. NOT `requestVideoFrameCallback`'s `presentedFrames` either:
     * exact, but absent on standard WebKitGTK and Android's WebView, and it needs a registered
     * callback to read at all.
     *
     * NULL is a first-class answer, and it is the honest one wherever the count cannot be had: an
     * engine without `getVideoPlaybackQuality`, a video with no dimensions, a non-finite count. A
     * source that cannot identify its frames must say so — `Stillness` then counts every tick,
     * exactly as it did before any of this existed — because a fabricated id reads as "always a
     * new frame", which is the belief being corrected.
     *
     * NOT YET VERIFIED ON A REAL CAMERA. The native half of D2 is measured end to end
     * (`NextDetectionTests`, mutation-checked); this half is reasoned from the specification and
     * held by unit tests over a stand-in element. What a browser actually reports for a
     * `MediaStream`-backed video is a claim only a device can make.
     */
    frameId: () => videoFrameId(video),
    grab() {
      ready();
      const w = video.videoWidth;
      const h = video.videoHeight;
      if (canvas.width !== w) canvas.width = w;
      if (canvas.height !== h) canvas.height = h;
      ctx.drawImage(video, 0, 0, w, h);
      const img = ctx.getImageData(0, 0, w, h);
      return { data: img.data, width: img.width, height: img.height };
    },
    stop: release
  };
}
async function openCamera(video, opts = {}, signal) {
  if (signal?.aborted) throw abortError();
  const stream = await acquireStream({ video: videoConstraints(opts), audio: false }, signal);
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
    return frameSourceOf(video, stream, ctx, canvas, release);
  } catch (err) {
    release();
    throw err;
  }
}

// src/detect-head.ts
var NUM_CLASSES = 6;
var DETECT_ROWS = 4 + NUM_CLASSES;

// src/letterbox.ts
function letterboxOf(width, height, imgsz) {
  const scale = imgsz / Math.max(width, height);
  const newW = Math.max(1, Math.round(width * scale));
  const newH = Math.max(1, Math.round(height * scale));
  return {
    scale,
    newW,
    newH,
    padX: Math.floor((imgsz - newW) / 2),
    padY: Math.floor((imgsz - newH) / 2)
  };
}
var IMG_SIZE = 640;
var PAD = 114 / 255;
function preprocess(frame, imgsz = IMG_SIZE) {
  const { src, w, h } = validatedFrame(frame, imgsz);
  const { scale, newW, newH, padX, padY } = letterboxOf(w, h, imgsz);
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
function validatedFrame(frame, imgsz) {
  const { data: src, width: w, height: h } = frame;
  if (!Number.isInteger(imgsz) || imgsz <= 0) {
    throw new Error(`preprocess: imgsz ${imgsz} is not a positive whole number of pixels`);
  }
  if (!Number.isInteger(w) || !Number.isInteger(h) || w <= 0 || h <= 0) {
    throw new Error(`preprocess: a frame of ${w}x${h} is not an image`);
  }
  if (src.length !== w * h * 4) {
    throw new Error(
      `preprocess: a ${w}x${h} RGBA frame is ${w * h * 4} bytes, but this one holds ${src.length}`
    );
  }
  return { src, w, h };
}

// src/onnx-postprocess.ts
var MIN_STICKER_CONFIDENCE = 0.25;
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
      const [cx, cy, w, h] = [at(0, a), at(1, a), at(2, a), at(3, a)];
      const side = (v) => Number.isFinite(v) && v > 0;
      if (!Number.isFinite(cx) || !Number.isFinite(cy) || !side(w) || !side(h)) continue;
      const scores = new Array(numClasses);
      for (let c = 0; c < numClasses; c++) scores[c] = at(4 + c, a);
      out.push({
        cx,
        cy,
        w,
        h,
        classId: best,
        confidence: bestScore,
        scores
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
var NESTED_INSIDE = 0.7;
var NESTED_MAX_AREA_RATIO = 4;
function overlapArea(a, b) {
  const iw = Math.max(
    0,
    Math.min(a.cx + a.w / 2, b.cx + b.w / 2) - Math.max(a.cx - a.w / 2, b.cx - b.w / 2)
  );
  const ih = Math.max(
    0,
    Math.min(a.cy + a.h / 2, b.cy + b.h / 2) - Math.max(a.cy - a.h / 2, b.cy - b.h / 2)
  );
  return iw * ih;
}
function dropNested(dets) {
  return dets.filter((d) => {
    const area = d.w * d.h;
    return !dets.some((o) => {
      const outer = o.w * o.h;
      return o !== d && outer > area && outer <= NESTED_MAX_AREA_RATIO * area && overlapArea(d, o) >= NESTED_INSIDE * area;
    });
  });
}
var ISOLATION_RADIUS = 3;
function dropIsolated(dets) {
  if (dets.length === 0) return dets;
  const sides = dets.map((d) => (d.w + d.h) / 2).sort((a, b) => a - b);
  const reach = ISOLATION_RADIUS * sides[Math.floor(sides.length / 2)];
  const reach2 = reach * reach;
  return dets.filter(
    (d) => dets.some((o) => {
      if (o === d) return false;
      const dx = o.cx - d.cx;
      const dy = o.cy - d.cy;
      return dx * dx + dy * dy <= reach2;
    })
  );
}
var MAX_STEP = 2.5;
var MAX_COLUMN_SPREAD = 3;
var MAX_AREA_RATIO = 5;
var LATTICE_TOLERANCE = 0.5;
var ROLL_TIE_BAND_DEG = 3;
var len2 = (v) => v[0] * v[0] + v[1] * v[1];
var DEG = 180 / Math.PI;
function centreOf(nine) {
  const mx = nine.reduce((s, d) => s + d.cx, 0) / 9;
  const my = nine.reduce((s, d) => s + d.cy, 0) / 9;
  let centre = nine[0];
  let nearest = Number.POSITIVE_INFINITY;
  for (const d of nine) {
    const dd = (d.cx - mx) * (d.cx - mx) + (d.cy - my) * (d.cy - my);
    if (dd < nearest) {
      nearest = dd;
      centre = d;
    }
  }
  return centre;
}
function perfectMatchings(items) {
  if (items.length === 0) return [[]];
  const [a, ...others] = items;
  const out = [];
  for (let k = 0; k < others.length; k++) {
    const b = others[k];
    const rest = [...others.slice(0, k), ...others.slice(k + 1)];
    for (const m of perfectMatchings(rest)) out.push([[a, b], ...m]);
  }
  return out;
}
var OUTER_MATCHINGS = perfectMatchings([0, 1, 2, 3, 4, 5, 6, 7]);
function antipodalDirs(rel) {
  let best = OUTER_MATCHINGS[0];
  let bestCost = Number.POSITIVE_INFINITY;
  for (const m of OUTER_MATCHINGS) {
    let cost = 0;
    for (const [i, j] of m)
      cost += Math.sqrt(len2([rel[i][0] + rel[j][0], rel[i][1] + rel[j][1]]));
    if (cost < bestCost) {
      bestCost = cost;
      best = m;
    }
  }
  return best.map(
    ([i, j]) => [(rel[i][0] - rel[j][0]) / 2, (rel[i][1] - rel[j][1]) / 2]
  );
}
function basisOf(dirs) {
  const nearer = (p, q) => Math.min(len2([p[0] - q[0], p[1] - q[1]]), len2([p[0] + q[0], p[1] + q[1]]));
  let basis = null;
  let miss = Number.POSITIVE_INFINITY;
  for (let a = 0; a < 4; a++) {
    for (let b = a + 1; b < 4; b++) {
      const u2 = dirs[a];
      const v2 = dirs[b];
      const rest = [0, 1, 2, 3].filter((k) => k !== a && k !== b).map((k) => dirs[k]);
      const sum = [u2[0] + v2[0], u2[1] + v2[1]];
      const diff = [u2[0] - v2[0], u2[1] - v2[1]];
      const r = Math.min(
        Math.sqrt(nearer(rest[0], sum)) + Math.sqrt(nearer(rest[1], diff)),
        Math.sqrt(nearer(rest[0], diff)) + Math.sqrt(nearer(rest[1], sum))
      );
      if (r < miss) {
        miss = r;
        basis = [a, b];
      }
    }
  }
  if (basis === null) return null;
  const u = dirs[basis[0]];
  const v = dirs[basis[1]];
  const step = Math.sqrt(Math.min(len2(u), len2(v)));
  if (!(step > 0) || miss > LATTICE_TOLERANCE * step) return null;
  return [u, v];
}
function orient(u0, v0) {
  const pointRight = (w) => w[0] < 0 || w[0] === 0 && w[1] < 0 ? [-w[0], -w[1]] : [w[0], w[1]];
  const u = pointRight(u0);
  const v = pointRight(v0);
  const tilt = (w) => Math.abs(Math.atan2(w[1], w[0]));
  let row = u;
  let col = v;
  if (tilt(v) < tilt(u)) {
    row = v;
    col = u;
  }
  if (col[1] < 0 || col[1] === 0 && col[0] < 0) col = [-col[0], -col[1]];
  return { row, col, gap: Math.abs(tilt(u) - tilt(v)) };
}
function cellsOf(centre, others, rel, row, col) {
  const det = row[0] * col[1] - row[1] * col[0];
  if (det === 0) return null;
  const cells = /* @__PURE__ */ new Map([[centre, [0, 0]]]);
  const taken = /* @__PURE__ */ new Set(["0,0"]);
  for (let k = 0; k < 8; k++) {
    const p = rel[k];
    const i = (p[0] * col[1] - p[1] * col[0]) / det;
    const j = (row[0] * p[1] - row[1] * p[0]) / det;
    const ci = Math.round(i);
    const cj = Math.round(j);
    if (ci < -1 || ci > 1 || cj < -1 || cj > 1) return null;
    const key = `${ci},${cj}`;
    if (taken.has(key)) return null;
    taken.add(key);
    cells.set(others[k], [ci, cj]);
  }
  return cells;
}
function latticeAbout(centre, nine) {
  const others = nine.filter((d) => d !== centre);
  const rel = others.map((d) => [d.cx - centre.cx, d.cy - centre.cy]);
  const basis = basisOf(antipodalDirs(rel));
  if (!basis) return { ok: false, reason: "no-basis" };
  const { row, col, gap } = orient(basis[0], basis[1]);
  const cells = cellsOf(centre, others, rel, row, col);
  if (!cells) return { ok: false, reason: "no-cells" };
  if (gap < 2 * ROLL_TIE_BAND_DEG / DEG) return { ok: false, reason: "roll-tie", gap: gap * DEG };
  return { ok: true, lattice: { row, col, cells } };
}
function fitLattice(nine) {
  if (nine.length !== 9 || new Set(nine).size !== 9) return { ok: false, reason: "not-nine" };
  return latticeAbout(centreOf(nine), nine);
}
function latticeOrder(nine, lattice) {
  return [...nine].sort((a, b) => {
    const [ai, aj] = lattice.cells.get(a);
    const [bi, bj] = lattice.cells.get(b);
    return aj - bj || ai - bi;
  });
}
function rowsByY(nine) {
  const byY = [...nine].sort((a, b) => a.cy - b.cy);
  return [byY.slice(0, 3), byY.slice(3, 6), byY.slice(6, 9)].map(
    (r) => r.sort((a, b) => a.cx - b.cx)
  );
}
function gridOf(nine) {
  const fit = fitLattice(nine);
  if (fit.ok) {
    const level = rowsByY(nine).flat();
    const ordered = latticeOrder(nine, fit.lattice);
    if (level.every((d, k) => d === ordered[k])) {
      const agreed = rulesOn(nine);
      return "fail" in agreed ? agreed : { ...agreed, ordering: "lattice" };
    }
    const phi = Math.atan2(fit.lattice.row[1], fit.lattice.row[0]);
    const cos = Math.cos(-phi);
    const sin = Math.sin(-phi);
    const centre = ordered[4];
    const turned = nine.map((d) => ({
      ...d,
      cx: centre.cx + (d.cx - centre.cx) * cos - (d.cy - centre.cy) * sin,
      cy: centre.cy + (d.cx - centre.cx) * sin + (d.cy - centre.cy) * cos
    }));
    const fitted = rulesOn(turned);
    if ("fail" in fitted) return fitted;
    return {
      grid: fitted.grid.map((t) => nine[turned.indexOf(t)]),
      ordering: "lattice"
    };
  }
  if (fit.reason === "roll-tie") {
    return { fail: { rule: "roll-tie", value: fit.gap, bound: 2 * ROLL_TIE_BAND_DEG } };
  }
  const sorted = rulesOn(nine);
  return "fail" in sorted ? sorted : { ...sorted, ordering: "sorted" };
}
function rulesOn(nine) {
  const rows = rowsByY(nine);
  const size = nine.reduce((s, d) => s + (d.w + d.h) / 2, 0) / 9;
  const areas = nine.map((d) => d.w * d.h);
  const largest = Math.max(...areas);
  const smallest = Math.min(...areas);
  if (largest > smallest * MAX_AREA_RATIO) {
    return { fail: { rule: "area-ratio", value: largest / smallest, bound: MAX_AREA_RATIO } };
  }
  for (const row of rows) {
    const spread = Math.max(...row.map((d) => d.cy)) - Math.min(...row.map((d) => d.cy));
    if (spread > size) return { fail: { rule: "row-spread", value: spread / size, bound: 1 } };
  }
  for (const c of [0, 1, 2]) {
    const xs = rows.map((r) => r[c].cx);
    const spread = Math.max(...xs) - Math.min(...xs);
    if (spread > size * MAX_COLUMN_SPREAD) {
      return { fail: { rule: "column-spread", value: spread / size, bound: MAX_COLUMN_SPREAD } };
    }
  }
  const rowY = rows.map((r) => r.reduce((s, d) => s + d.cy, 0) / 3);
  const colX = [0, 1, 2].map((c) => rows.reduce((s, r) => s + r[c].cx, 0) / 3);
  const steps = [
    rowY[1] - rowY[0],
    rowY[2] - rowY[1],
    colX[1] - colX[0],
    colX[2] - colX[1]
  ];
  for (const step of steps) {
    if (step < size * 0.4) return { fail: { rule: "step-short", value: step / size, bound: 0.4 } };
    if (step > size * MAX_STEP)
      return { fail: { rule: "step-long", value: step / size, bound: MAX_STEP } };
  }
  return { grid: rows.flat() };
}
var MAX_CLUTTER_SET_ASIDE = 3;
var CLUTTER_AREA_RATIO = MAX_AREA_RATIO;
function fitFace(dets, minConf = MIN_STICKER_CONFIDENCE) {
  const good = dets.filter((d) => d.confidence >= minConf && d.classId >= 0 && d.classId < 6);
  if (good.length === 0) return { ok: false, reason: "NO_FACE" };
  const neighboured = dropIsolated(good);
  if (neighboured.length < 9) return { ok: false, reason: "PARTIAL_FACE" };
  const bySize = [...neighboured].sort((a, b) => b.w * b.h - a.w * a.h);
  const nine = bySize.slice(0, 9).map((d) => d.w * d.h).sort((a, b) => a - b);
  const clutterAbove = CLUTTER_AREA_RATIO * nine[Math.floor(nine.length / 2)];
  let first;
  let fitted;
  let grid;
  let ordering = "lattice";
  for (let aside = 0; aside <= MAX_CLUTTER_SET_ASIDE; aside++) {
    if (bySize.length - aside < 9) break;
    if (aside > 0 && !(bySize[aside - 1].w * bySize[aside - 1].h > clutterAbove)) break;
    const attempt = gridOf(bySize.slice(aside, aside + 9));
    if (!("fail" in attempt)) {
      fitted = attempt;
      grid = attempt.grid;
      ordering = attempt.ordering;
      break;
    }
    if (aside === 0) first = attempt.fail;
  }
  if (!fitted || !grid) {
    return first === void 0 ? { ok: false, reason: "PARTIAL_FACE" } : { ok: false, reason: "BAD_GEOMETRY", geometry: first };
  }
  return {
    ok: true,
    face: {
      colors: grid.map((d) => d.classId),
      confidence: grid.map((d) => d.confidence),
      // Only when EVERY sticker has them. Nine-of-each is a whole-cube constraint; a face with
      // eight score vectors and one gap cannot contribute to it, and silently passing a short
      // array would fail much further away from the cause.
      scores: grid.every((d) => d.scores) ? grid.map((d) => d.scores) : void 0,
      // Detections carry a CENTRE and a size; a box here is the corner form the pixel reader wants.
      boxes: grid.map(
        (d) => [d.cx - d.w / 2, d.cy - d.h / 2, d.w, d.h]
      ),
      ordering
    }
  };
}

// src/onnx-detect.ts
function detectionsFromOutput(output, opts = {}) {
  const {
    numClasses = NUM_CLASSES,
    confThreshold = MIN_STICKER_CONFIDENCE,
    iouThreshold = 0.45
  } = opts;
  const expected = 4 + numClasses;
  if (output.rows !== expected) {
    const why = output.rows >= output.anchors ? ` \u2014 ${output.rows} rows against ${output.anchors} anchors is the transpose of a detect head` : "";
    throw new Error(
      `model output has ${output.rows} rows, not the ${expected} a ${numClasses}-class detect head produces${why}`
    );
  }
  return dropNested(
    nms(decodeDetections(output.data, numClasses, output.anchors, confThreshold), iouThreshold)
  );
}

// src/fit-trace.ts
var NEAR_FLOOR = 0.1;
var BOX_CAP = 16;
var NEAR_CANDIDATES = 300;
var r1 = (v) => Math.round(v * 10) / 10;
var r3 = (v) => Math.round(v * 1e3) / 1e3;
function box(d, kept) {
  return {
    x: r1(d.cx),
    y: r1(d.cy),
    w: r1(d.w),
    h: r1(d.h),
    cls: d.classId,
    conf: r3(d.confidence),
    kept
  };
}
function centreProbe(kept, near) {
  if (kept.length < 4) return null;
  const xs = kept.map((d) => d.cx);
  const ys = kept.map((d) => d.cy);
  const mx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const my = (Math.min(...ys) + Math.max(...ys)) / 2;
  const size = kept.reduce((s, d) => s + (d.w + d.h) / 2, 0) / kept.length;
  let best = null;
  for (const [set, isKept] of [
    [kept, true],
    [near, false]
  ]) {
    for (const d of set) {
      const dist = Math.hypot(d.cx - mx, d.cy - my) / size;
      if (best === null || dist < best.dist) best = { d, kept: isKept, dist };
    }
  }
  if (best === null || best.dist > 0.6) return { found: false };
  return {
    found: true,
    cls: best.d.classId,
    conf: r3(best.d.confidence),
    kept: best.kept,
    dist: r3(best.dist),
    ...best.d.scores ? { scores: best.d.scores.map(r3) } : {}
  };
}
function fittedCentre(face) {
  const scores = face.scores?.[4];
  return {
    found: true,
    cls: face.colors[4],
    conf: r3(face.confidence[4]),
    kept: true,
    dist: 0,
    ...scores ? { scores: scores.map(r3) } : {}
  };
}
function traceFrame(output, opts = {}, kept = detectionsFromOutput(output, opts)) {
  const threshold = opts.confThreshold ?? MIN_STICKER_CONFIDENCE;
  const fit = fitFace(kept, opts.minConf ?? MIN_STICKER_CONFIDENCE);
  const candidates = decodeDetections(
    output.data,
    opts.numClasses ?? NUM_CLASSES,
    output.anchors,
    opts.floor ?? NEAR_FLOOR
  ).sort((a, b) => b.confidence - a.confidence).slice(0, NEAR_CANDIDATES);
  const nearDets = nms(candidates, opts.iouThreshold ?? 0.45).filter(
    (d) => d.confidence < threshold
  );
  const cap = opts.cap ?? BOX_CAP;
  const boxes = [
    ...[...kept].sort((a, b) => b.w * b.h - a.w * a.h).map((d) => box(d, true)),
    ...[...nearDets].sort((a, b) => b.confidence - a.confidence).map((d) => box(d, false))
  ].slice(0, cap);
  return {
    fit,
    kept: kept.length,
    near: nearDets.length,
    boxes,
    centre: fit.ok ? fittedCentre(fit.face) : centreProbe(kept, nearDets)
  };
}

// src/session-record.ts
var SESSION_SCHEMA = "cubus-scan-session/1";
var NEAR_FLOOR_RECORD = 0.05;

// src/sticker-pixels.ts
var INNER = 0.6;
function toFrameBox(box2, frame, imgsz) {
  const { scale, padX, padY } = letterboxOf(frame.width, frame.height, imgsz);
  return [(box2[0] - padX) / scale, (box2[1] - padY) / scale, box2[2] / scale, box2[3] / scale];
}
function medianLab(frame, box2) {
  if (!box2.every(Number.isFinite)) return null;
  const cx = box2[0] + box2[2] / 2;
  const cy = box2[1] + box2[3] / 2;
  const x0 = Math.max(0, Math.floor(cx - box2[2] * INNER / 2));
  const x1 = Math.min(frame.width, Math.ceil(cx + box2[2] * INNER / 2));
  const y0 = Math.max(0, Math.floor(cy - box2[3] * INNER / 2));
  const y1 = Math.min(frame.height, Math.ceil(cy + box2[3] * INNER / 2));
  if (x1 <= x0 || y1 <= y0) return null;
  const l = [];
  const a = [];
  const b = [];
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * frame.width + x) * 4;
      const [L, A, B] = rgbToLab(frame.data[i], frame.data[i + 1], frame.data[i + 2]);
      l.push(L);
      a.push(A);
      b.push(B);
    }
  }
  return [median(l), median(a), median(b)];
}
function stickerLab(frame, boxes, imgsz) {
  const out = [];
  for (const box2 of boxes) {
    const lab = medianLab(frame, toFrameBox(box2, frame, imgsz));
    if (!lab) return null;
    out.push(lab);
  }
  return out;
}
function rgbToLab(r, g, b) {
  const lin = (v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const [R, G, B] = [lin(r), lin(g), lin(b)];
  const x = (0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047;
  const y = 0.2126 * R + 0.7152 * G + 0.0722 * B;
  const z = (0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883;
  const f = (t) => t > 8856e-6 ? Math.cbrt(t) : 7.787 * t + 16 / 116;
  const [fx, fy, fz] = [f(x), f(y), f(z)];
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}
function median(values) {
  values.sort((p, q) => p - q);
  const mid = values.length >> 1;
  return values.length % 2 ? values[mid] : (values[mid - 1] + values[mid]) / 2;
}

// view/native-detector.ts
var CUBE_VISION = "plugin:cube-vision|";
var P = CUBE_VISION;
var cameraClaim = 0;
var claims = 0;
var mayClose = (claim) => cameraClaim === 0 || cameraClaim === claim;
var closing = Promise.resolve();
var closesOut = 0;
var opening = Promise.resolve();
var opensOut = 0;
var CLOSE_TIMEOUT_MS = 1e4;
var newest = null;
async function awaitClosesLanded(abandoned) {
  while (closesOut > 0) {
    await closing;
    abandoned();
  }
}
function trackOpen(sent) {
  opensOut++;
  const settled = () => {
    opensOut--;
    if (opensOut === 0) opening = Promise.resolve();
  };
  opening = Promise.all([opening, sent.then(settled, settled)]);
}
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
  invoke;
  computeUnits;
  dev = null;
  loaded = false;
  /** Bumped by `stop()`, so an open still crossing the bridge knows it has been cancelled. */
  opening = 0;
  /** This detector's most recent claim on the one native camera — see `cameraClaim`. */
  claim = 0;
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
    const claim = ++claims;
    this.claim = claim;
    cameraClaim = claim;
    let issued = false;
    const abort = () => {
      this.closeCamera(claim);
      if (issued) this.repairIfOvertaken(claim);
      throw new DOMException("camera open superseded", "AbortError");
    };
    if (closesOut > 0) {
      await awaitClosesLanded(() => {
        if (cancelled()) abort();
      });
    }
    cameraClaim = claim;
    try {
      const sent = this.invoke(`${P}open_camera`, { deviceId: opts.deviceId ?? null });
      issued = true;
      newest = { claim, opts, landed: false };
      trackOpen(sent);
      await sent;
      if (newest?.claim === claim) newest.landed = true;
    } catch (err) {
      if (cameraClaim === claim) cameraClaim = 0;
      if (newest?.claim === claim) newest = null;
      throw err;
    }
    if (cancelled()) abort();
    let info;
    try {
      info = nativeDevice(await this.invoke(`${P}current_camera`));
    } catch (err) {
      this.dev = null;
      this.closeCamera(claim);
      throw err;
    }
    if (cancelled()) abort();
    this.dev = info ?? { deviceId: opts.deviceId ?? "", label: "Camera" };
  }
  /**
   * Compile the model, ONCE.
   *
   * Two guards for one rule. `loaded` covers a second call after the first finished — which the
   * page-level detector park makes ordinary, since a re-mounted panel asks its parked detector to
   * load again and must not pay for a second CoreML/LiteRT compile. `loading` covers two calls
   * that OVERLAP, which the panel's slow-load timeout can produce: without it both crossed the
   * bridge and the plugin compiled twice.
   */
  loading = null;
  /** Bumped by `dispose()`, so a load still crossing the bridge cannot mark the model loaded after it. */
  loadGeneration = 0;
  async load() {
    if (this.loaded) return;
    if (this.loading) return this.loading;
    const generation = this.loadGeneration;
    this.loading = this.invoke(`${P}load_model`, { computeUnits: this.computeUnits }).then(() => {
      if (generation === this.loadGeneration) this.loaded = true;
    }).finally(() => {
      if (generation === this.loadGeneration) this.loading = null;
    });
    return this.loading;
  }
  async next() {
    const reply = await this.invoke(`${P}next_detection`);
    if (reply instanceof ArrayBuffer) return decodeTensorResponse(reply);
    if (reply !== null && typeof reply === "object" && "tensor" in reply) {
      const { tensor } = reply;
      if (typeof tensor === "string") return decodeTensorResponse(tensor);
      throw new Error(`cube-vision: next_detection answered with a ${typeof tensor} tensor`);
    }
    throw new Error(
      `cube-vision: next_detection answered with ${reply === null ? "null" : `a ${typeof reply}`}, not a tensor`
    );
  }
  /**
   * The RGBA pixels of the frame with `frameId`, or null when the plugin no longer holds it (D7).
   *
   * The wire is `[width, height]` as two little-endian int32s, then `width * height * 4` RGBA
   * bytes — and the 8-byte header alone, both zero, for "that frame is gone", which is an ordinary
   * answer rather than a failure: a tick lands or the camera closes between the fit and this call.
   *
   * Android's plugin API is JSON only, so the bytes arrive base64-encoded there exactly as the
   * tensor does; Apple hands back an ArrayBuffer and nothing is copied.
   */
  async framePixels(frameId) {
    const reply = await this.invoke(`${P}frame_pixels`, { frameId });
    return decodeFramePixels(reply);
  }
  async cameras() {
    return nativeCameras(await this.invoke(`${P}list_cameras`));
  }
  stop() {
    this.opening++;
    this.dev = null;
    this.closeCamera(this.claim);
  }
  /**
   * Release the camera AND forget the model, so the next `load()` asks the plugin to build it again.
   *
   * ADDED 2026-09-21, for the panel's recovery from an inference that never settled: `tickFail`
   * disposes the detector and clears `modelLoaded`, so that Start builds a fresh session — which it
   * did for `WebDetector` and not here, because this class had no `dispose()` and its `load()` then
   * answered "already loaded" without crossing the bridge. The wedged plugin session was kept, and
   * every Start after a timeout was the same fifteen seconds and the same notice. The model lives in
   * the plugin, so what is released here is this side's CLAIM on it: `load_model` is sent again,
   * and the plugin replaces what it holds (each platform's `load_model` builds anew). Not a
   * tombstone, exactly as `Detector.dispose` says: a `load()` or `use()` after this is a new caller.
   */
  dispose() {
    this.stop();
    this.loadGeneration++;
    this.loaded = false;
    this.loading = null;
  }
  /**
   * This attempt's open has landed, cancelled — and if the NEWEST open had already landed by then,
   * this one ran after it and the lens is on this attempt's device, not its owner's: re-issue that
   * owner's open (see `closing`, "two opens are not ordered"). Nothing to do when the newest is
   * still in flight (it lands after, and so ran after), when the newest is this attempt, or when
   * the newest owner has since let the claim go (its `stop()` closed what it held).
   */
  repairIfOvertaken(claim) {
    const owner = newest;
    if (!owner || owner.claim === claim || !owner.landed || cameraClaim !== owner.claim) return;
    const sent = this.invoke(`${P}open_camera`, { deviceId: owner.opts.deviceId ?? null });
    trackOpen(sent);
    void sent.then(
      () => {
      },
      (err) => {
        console.warn(
          "[cubus] the native camera could not be reopened for its owner after an abandoned open landed late",
          err
        );
      }
    );
  }
  /**
   * Close the one native camera, if this claim is entitled to. See `cameraClaim`.
   *
   * Fire-and-forget, because releasing the camera must not make `stop()` async — the panel calls it
   * from synchronous teardown, and there is nothing a caller could do with the answer. Not
   * fire-and-FORGET, though, which is what it was: the close joins `closing`, so the next open
   * waits for it rather than overtaking it.
   */
  closeCamera(claim) {
    if (!mayClose(claim)) return;
    cameraClaim = 0;
    if (opensOut > 0) {
      void opening.then(() => {
        this.sendClose(claim);
      });
      return;
    }
    this.sendClose(claim);
  }
  /**
   * Issue `close_camera` for `claim` — unless the claim has moved on while this close was held.
   *
   * A close that WAITED is a close whose reason may have expired: an attempt that claimed the
   * camera meanwhile is about to own the lens, and sending this one now would be the very
   * overtaking the wait exists to prevent, arriving one step later. Dropping it is safe because
   * the claim was given back on the way in — the new owner's own `stop()` closes what it opened.
   *
   * The count and the call go out together, in one synchronous block, because that is what leaves
   * no window for an open to check the count and be issued in between.
   *
   * A FAILURE IS SAID OUT LOUD (2026-09-05). This used to swallow it under the note that "the
   * camera closes a tick later", which nothing implemented — nothing retries, so a rejected
   * `close_camera` is a lens left on for the life of the process with no error anywhere. What IS
   * true is that the claim is given back first, so the plugin is left closable: `mayClose` admits
   * anyone once `cameraClaim` is 0, and the next `stop()` or `use()` issues a close that can
   * succeed. That is the recovery, and it is worth nothing unless somebody knows to look, hence
   * the warning.
   */
  sendClose(claim) {
    if (!mayClose(claim)) return;
    closesOut++;
    const sent = this.invoke(`${P}close_camera`).then(
      () => {
      },
      (err) => {
        console.warn(
          "[cubus] the native camera did not close \u2014 the lens may still be on until something opens or closes it again",
          err
        );
      }
    );
    let counted = false;
    const countOut = () => {
      if (counted) return;
      counted = true;
      closesOut--;
      if (closesOut === 0) closing = Promise.resolve();
    };
    let timer;
    const gaveUp = new Promise((resolve) => {
      timer = setTimeout(() => {
        console.warn(
          `[cubus] the native camera's close_camera did not answer within ${Math.round(CLOSE_TIMEOUT_MS / 1e3)} seconds \u2014 presumed lost; a later open no longer waits for it`
        );
        resolve();
      }, CLOSE_TIMEOUT_MS);
    });
    const settled = sent.then(() => {
      clearTimeout(timer);
    });
    closing = Promise.all([closing, Promise.race([settled, gaveUp]).then(countOut)]);
  }
};
function nativeCameras(raw) {
  if (!Array.isArray(raw)) {
    throw new Error(
      `cube-vision: list_cameras answered with ${raw === null ? "null" : `a ${typeof raw}`}, not a list`
    );
  }
  return raw.map((entry, i) => {
    const device = nativeDevice(entry);
    if (device === null) throw new Error(`cube-vision: list_cameras entry ${i} is not a camera`);
    return device;
  });
}
function base64ToBuffer(b64) {
  if (b64.length === 0) return null;
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}
function decodeFramePixels(input) {
  let buf;
  if (input instanceof ArrayBuffer) buf = input;
  else if (typeof input === "string") buf = base64ToBuffer(input);
  else if (input !== null && typeof input === "object" && "pixels" in input) {
    const { pixels } = input;
    if (typeof pixels !== "string") {
      throw new Error(`cube-vision: frame_pixels answered with ${typeof pixels} pixels`);
    }
    buf = base64ToBuffer(pixels);
  } else {
    throw new Error(
      `cube-vision: frame_pixels answered with ${input === null ? "null" : `a ${typeof input}`}`
    );
  }
  if (buf === null || buf.byteLength < 8) return null;
  const [width, height] = new Int32Array(buf, 0, 2);
  if (width === 0 && height === 0) return null;
  if (width <= 0 || height <= 0) {
    throw new Error(`cube-vision: frame_pixels reported a ${width}x${height} picture`);
  }
  const need = width * height * 4;
  if (!Number.isSafeInteger(need)) {
    throw new Error(`cube-vision: a ${width}x${height} frame names a length no buffer has`);
  }
  if (buf.byteLength !== 8 + need) {
    throw new Error(
      `cube-vision: frame_pixels is ${buf.byteLength} bytes, need ${8 + need} for ${width}x${height}`
    );
  }
  return {
    data: new Uint8ClampedArray(buf, 8, need),
    width,
    height
  };
}
function decodeTensorResponse(input) {
  const buf = typeof input === "string" ? base64ToBuffer(input) : input;
  if (buf === null) return null;
  const versioned = buf.byteLength >= 4 && new Int32Array(buf, 0, 1)[0] < 0;
  if (!versioned && buf.byteLength < 8) return null;
  const { rows, anchors, headerBytes, picture, frameId } = tensorHeader(buf);
  if (anchors === 0) return null;
  const count2 = rows * anchors;
  const need = headerBytes + count2 * 4;
  if (!Number.isSafeInteger(need)) {
    throw new Error(`cube-vision tensor: a ${rows}\xD7${anchors} header names a length no buffer has`);
  }
  if (buf.byteLength !== need) {
    throw new Error(
      `cube-vision tensor is ${buf.byteLength} bytes, need ${need} for ${rows}\xD7${anchors}`
    );
  }
  const data = new Float32Array(buf, headerBytes, count2);
  return {
    data,
    anchors,
    rows,
    ...picture ? { picture } : {},
    ...frameId === void 0 ? {} : { frameId }
  };
}
function tensorHeader(buf) {
  const first = new Int32Array(buf, 0, 1)[0];
  if (first >= 0) {
    const [rows2, anchors2] = new Int32Array(buf, 0, 2);
    if (rows2 > 0 && anchors2 > 0) return { rows: rows2, anchors: anchors2, headerBytes: 8 };
    if (rows2 === 0 && anchors2 === 0) return { rows: 0, anchors: 0, headerBytes: 8 };
    throw new Error(
      `cube-vision tensor: a version 1 header of ${rows2}\xD7${anchors2} is neither a frame nor "no frame"`
    );
  }
  if (first !== -2 && first !== -3) {
    throw new Error(`cube-vision tensor: unknown wire version ${-first}`);
  }
  const words = first === -2 ? 5 : 6;
  const headerBytes = words * 4;
  if (buf.byteLength < headerBytes) {
    throw new Error(
      `cube-vision tensor: a version ${-first} header is ${headerBytes} bytes, got ${buf.byteLength}`
    );
  }
  const header = new Int32Array(buf, 0, words);
  const [rows, anchors, width, height] = [header[1], header[2], header[3], header[4]];
  if (rows > 0 && anchors > 0 && width > 0 && height > 0) {
    const frameId = first === -3 ? header[5] : void 0;
    return {
      rows,
      anchors,
      headerBytes,
      picture: { width, height },
      ...frameId === void 0 ? {} : { frameId }
    };
  }
  if (rows === 0 && anchors === 0 && width === 0 && height === 0) {
    return { rows, anchors, headerBytes };
  }
  throw new Error(
    `cube-vision tensor: a version ${-first} header of ${rows}\xD7${anchors} with a ${width}\xD7${height} picture is neither a frame nor "no frame"`
  );
}
function nativeDevice(raw) {
  if (raw === null || raw === void 0) return null;
  const r = raw;
  if (typeof r.deviceId !== "string")
    throw new Error("cube-vision: current_camera answered with no deviceId");
  const facing = facingOf(r.facing);
  return {
    deviceId: r.deviceId,
    label: typeof r.label === "string" && r.label ? r.label : "Camera",
    ...facing ? { facing } : {}
  };
}

// view/inference-protocol.ts
function transferable(data) {
  const owned = data.buffer instanceof ArrayBuffer && data.byteOffset === 0 && data.byteLength === data.buffer.byteLength;
  return owned ? data : new Float32Array(data);
}

// view/onnx-runtime.ts
var ortByUrl = /* @__PURE__ */ new Map();
var urlOf = /* @__PURE__ */ new WeakMap();
var retiredAt = /* @__PURE__ */ new Map();
var retired = /* @__PURE__ */ new WeakSet();
var withQuery = (url, key, value) => {
  const [addr = "", hash = ""] = url.split(/(?=#)/, 2);
  return `${addr}${addr.includes("?") ? "&" : "?"}${key}=${value}${hash}`;
};
var RuntimeRetiredError = class extends Error {
  constructor() {
    super(
      "the runtime module is retired: a link of its chain did not settle within the chain's patience, so nothing new runs on it \u2014 a new session loads a fresh module"
    );
    this.name = "RuntimeRetiredError";
  }
};
var configuring = /* @__PURE__ */ new WeakMap();
var configured = /* @__PURE__ */ new WeakMap();
var RUN_CHAIN_TIMEOUT_MS = 3e4;
var chainTimeoutMs = RUN_CHAIN_TIMEOUT_MS;
function retire(ort, why) {
  if (retired.has(ort)) return;
  retired.add(ort);
  const url = urlOf.get(ort);
  if (url !== void 0) {
    ortByUrl.delete(url);
    retiredAt.set(url, (retiredAt.get(url) ?? 0) + 1);
  }
  console.warn(
    `[cubus] ${why}: the runtime module is retired, and the next session loads a fresh one`
  );
}
function serialise(ort, work, kind = "work") {
  const prev = configuring.get(ort) ?? Promise.resolve();
  let release = () => {
  };
  const released = new Promise((resolve) => {
    release = resolve;
  });
  configuring.set(ort, released);
  return prev.then(async () => {
    try {
      if (kind === "work" && retired.has(ort)) throw new RuntimeRetiredError();
      const timer = setTimeout(() => {
        retire(ort, `a link of the runtime's chain did not settle within ${chainTimeoutMs} ms`);
        release();
      }, chainTimeoutMs);
      try {
        return await work();
      } finally {
        clearTimeout(timer);
      }
    } finally {
      release();
    }
  });
}
var loadOrt = (url) => {
  let pending = ortByUrl.get(url);
  if (!pending) {
    const generation = retiredAt.get(url) ?? 0;
    const target = generation === 0 ? url : withQuery(url, "cubus-runtime-generation", `${generation}`);
    pending = import(
      /* @vite-ignore */
      target
    ).then(
      (ort) => {
        urlOf.set(ort, url);
        return ort;
      },
      (err) => {
        ortByUrl.delete(url);
        throw err;
      }
    );
    ortByUrl.set(url, pending);
  }
  return pending;
};
var runtimeUrl = (url, proxied) => proxied ? withQuery(url, "cubus-runtime", "proxied") : url;
var proxiedSiblingUrl = (url) => {
  const match = /^([^?#]*?)([^/?#]+)(\?[^#]*)?(#.*)?$/.exec(url);
  if (!match) return url;
  const [, dir = "", file = "", query = "", hash = ""] = match;
  const dot = file.lastIndexOf(".");
  const named = dot > 0 ? `${file.slice(0, dot)}.proxied${file.slice(dot)}` : `${file}.proxied`;
  return `${dir}${named}${query}${hash}`;
};
async function loadRuntime(ortUrl, proxied) {
  if (!proxied) return loadOrt(ortUrl);
  try {
    return await loadOrt(runtimeUrl(ortUrl, true));
  } catch (err) {
    const sibling = proxiedSiblingUrl(ortUrl);
    if (sibling === ortUrl) throw err;
    try {
      const ort = await loadOrt(sibling);
      console.info(
        `[cubus] the runtime's query-string identity did not load here \u2014 using ${sibling} instead`
      );
      return ort;
    } catch {
      throw err;
    }
  }
}
var documentVisibility = {
  hidden: () => globalThis.document?.visibilityState === "hidden",
  watch(onChange) {
    const doc = globalThis.document;
    doc?.addEventListener?.("visibilitychange", onChange);
    return () => doc?.removeEventListener?.("visibilitychange", onChange);
  }
};
var GPU_BUDGET_MS = 400;
var GPU_PROBE_RUNS = 2;
var SOFTWARE_RENDERERS = [
  "swiftshader",
  "llvmpipe",
  "lavapipe",
  "softpipe",
  "warp",
  "basic render",
  "microsoft basic"
];
function softwareAdapter(adapter) {
  if (adapter.isFallbackAdapter === true || adapter.info?.isFallbackAdapter === true) return true;
  const info = adapter.info;
  if (!info) return false;
  const text = `${info.vendor ?? ""} ${info.architecture ?? ""} ${info.description ?? ""}`.toLowerCase().trim();
  if (text.length === 0) return false;
  return SOFTWARE_RENDERERS.some((name) => text.includes(name));
}
async function preferredProviders() {
  const gpu = globalThis.navigator?.gpu;
  if (!gpu) return ["wasm"];
  try {
    const adapter = await gpu.requestAdapter();
    if (!adapter) return ["wasm"];
    if (softwareAdapter(adapter)) {
      console.info(
        "[cubus] WebGPU offers only a software adapter \u2014 using the wasm runtime instead"
      );
      return ["wasm"];
    }
    return ["webgpu", "wasm"];
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
function webgpuBackendLive(ort) {
  const webgpu = ort.env.webgpu;
  if (typeof webgpu !== "object" || webgpu === null) return null;
  return Boolean(webgpu.device);
}
function webgpuQueue(ort) {
  const device = ort.env.webgpu?.device;
  const queue = device?.queue;
  if (typeof queue !== "object" || queue === null) return null;
  return typeof queue.submit === "function" ? queue : null;
}
var queueWatches = /* @__PURE__ */ new WeakMap();
function watchQueue(queue) {
  let watch = queueWatches.get(queue);
  if (!watch) {
    const original = Object.getOwnPropertyDescriptor(queue, "submit");
    const submit = queue.submit;
    const counters = /* @__PURE__ */ new Set();
    const wrapper = function(...args) {
      for (const counter2 of counters) counter2.n++;
      return submit.apply(this, args);
    };
    try {
      Object.defineProperty(queue, "submit", {
        configurable: true,
        writable: true,
        enumerable: original?.enumerable ?? false,
        value: wrapper
      });
    } catch {
      return null;
    }
    watch = { wrapper, original, counters };
    queueWatches.set(queue, watch);
  }
  const live = watch;
  const counter = { n: 0 };
  live.counters.add(counter);
  let released = false;
  return {
    counter,
    release() {
      if (released) return;
      released = true;
      live.counters.delete(counter);
      if (live.counters.size > 0) return;
      queueWatches.delete(queue);
      if (queue.submit !== live.wrapper) return;
      if (live.original) Object.defineProperty(queue, "submit", live.original);
      else delete queue.submit;
    }
  };
}
async function gpuRanTheGraph(ort, probe) {
  const queue = webgpuQueue(ort);
  const watch = queue ? watchQueue(queue) : null;
  if (!watch) {
    await probe();
    return null;
  }
  try {
    await probe();
  } finally {
    watch.release();
  }
  return watch.counter.n > 0;
}
async function bestTimedRun(probe, visibility) {
  const hidden = () => visibility.hidden();
  if (hidden()) return null;
  let wentHidden = false;
  const noteHidden = () => {
    if (hidden()) wentHidden = true;
  };
  const unwatch = visibility.watch(noteHidden);
  let best = Number.POSITIVE_INFINITY;
  let watched = true;
  try {
    for (let i = 0; i < GPU_PROBE_RUNS && watched; i++) {
      const started = performance.now();
      await probe();
      if (hidden() || wentHidden) watched = false;
      else best = Math.min(best, performance.now() - started);
    }
  } finally {
    unwatch();
  }
  return watched && !hidden() && !wentHidden ? best : null;
}
async function owning(session, work) {
  let owned = true;
  try {
    return await work(() => {
      owned = false;
    });
  } catch (err) {
    if (owned) await session.release().catch(() => {
    });
    throw err;
  }
}
function inputSide(session) {
  const meta = session.inputMetadata?.[0];
  const dims = meta?.isTensor ? meta.shape : void 0;
  const h = dims?.[2];
  return typeof h === "number" && h > 0 ? h : IMG_SIZE;
}
function validatedRun(ort, session, inputName, outputName) {
  return async (input, imgsz) => {
    const tensor = new ort.Tensor("float32", input, [1, 3, imgsz, imgsz]);
    const result = await session.run({ [inputName]: tensor });
    const out = result[outputName];
    if (!out) throw new Error(`model produced no '${outputName}' output`);
    if (out.type !== "float32" || !(out.data instanceof Float32Array)) {
      throw new Error(`model output '${outputName}' is ${out.type}, not float32`);
    }
    const shape = `[${out.dims.join(", ")}]`;
    if (out.dims.length !== 3 || out.dims[0] !== 1) {
      throw new Error(
        `model output '${outputName}' has dims ${shape}, not the [1, rows, anchors] a detect head produces`
      );
    }
    const rows = out.dims[1] ?? 0;
    const anchors = out.dims[2] ?? 0;
    if (!Number.isInteger(rows) || !Number.isInteger(anchors) || rows <= 0 || anchors <= 0) {
      throw new Error(`model output '${outputName}' has dims ${shape}, which has no anchor axis`);
    }
    if (rows !== DETECT_ROWS) {
      const why = rows >= anchors ? ` \u2014 ${rows} rows against ${anchors} anchors is the transpose of a detect head` : "";
      throw new Error(
        `model output '${outputName}' has dims ${shape}: ${rows} rows, not the ${DETECT_ROWS} a ${DETECT_ROWS - 4}-class detect head produces${why}`
      );
    }
    if (out.data.length !== rows * anchors) {
      throw new Error(
        `model output '${outputName}' holds ${out.data.length} floats, not the ${rows * anchors} its dims ${shape} promise`
      );
    }
    return { data: out.data, anchors, rows };
  };
}
async function createSession(ort, cfg) {
  const { modelUrl, ortUrl, numThreads, wasmDir, proxied, executionProviders } = cfg;
  return serialise(ort, async () => {
    const first = configured.get(ort);
    if (first && (first.numThreads !== numThreads || first.wasmPaths !== wasmDir)) {
      throw new Error(
        `the runtime at ${ortUrl} is already initialised with numThreads ${first.numThreads} and wasmPaths ${first.wasmPaths}; this runner asked for ${numThreads} and ${wasmDir}, which onnxruntime cannot change on a live module`
      );
    }
    ort.env.wasm.numThreads = numThreads;
    ort.env.wasm.proxy = proxied;
    ort.env.wasm.wasmPaths = wasmDir;
    configured.set(ort, { numThreads, wasmPaths: wasmDir });
    return ort.InferenceSession.create(modelUrl, {
      executionProviders,
      graphOptimizationLevel: "all"
    });
  });
}
async function createModelRunner(modelUrl, opts = {}) {
  const chosenHere = opts.executionProviders === void 0;
  const executionProviders = opts.executionProviders ?? await preferredProviders();
  const gpu = usesGpu(executionProviders);
  const ortUrl = opts.ortUrl ?? "./ort.mjs";
  const proxied = !gpu && !opts.offPageThread;
  const ort = await loadRuntime(ortUrl, proxied);
  const numThreads = opts.numThreads ?? defaultThreadCount();
  const wasmDir = opts.wasmPaths ?? "./";
  let session;
  try {
    session = await createSession(ort, {
      modelUrl,
      ortUrl,
      numThreads,
      wasmDir,
      // The proxy is OFF for the GPU path — see `createSession` for why that is not a compromise.
      proxied,
      executionProviders
    });
  } catch (err) {
    if (!(err instanceof RuntimeRetiredError)) throw err;
    return createModelRunner(modelUrl, opts);
  }
  return owning(session, async (relinquish) => {
    const rebuildOnWasm = async (why) => {
      console.info(why);
      relinquish();
      await session.release().catch(() => {
      });
      return createModelRunner(modelUrl, { ...opts, executionProviders: ["wasm"] });
    };
    const gpuVerdict = gpu && chosenHere ? webgpuBackendLive(ort) : null;
    const notTheGpu = "[cubus] WebGPU did not take this model \u2014 using the wasm runtime, off the page thread";
    if (gpuVerdict === false) return rebuildOnWasm(notTheGpu);
    const inputName = session.inputNames[0];
    const outputName = session.outputNames[0];
    if (!inputName || !outputName) throw new Error("model has no input/output tensor");
    const run = validatedRun(ort, session, inputName, outputName);
    const side = inputSide(session);
    const probe = () => run(new Float32Array(3 * side * side), side);
    if (opts.warmUp ?? true) {
      const measured = await serialise(ort, async () => {
        let ranOnGpu = null;
        if (gpuVerdict === true) ranOnGpu = await gpuRanTheGraph(ort, probe);
        else await probe();
        if (ranOnGpu === false) return { ranOnGpu, best: null };
        const best = gpu && chosenHere ? await bestTimedRun(probe, opts.visibility ?? documentVisibility) : null;
        return { ranOnGpu, best };
      });
      if (measured.ranOnGpu === false) return rebuildOnWasm(notTheGpu);
      const budget = opts.gpuBudgetMs ?? GPU_BUDGET_MS;
      if (measured.best !== null && measured.best > budget) {
        return rebuildOnWasm(
          `[cubus] the GPU ran this model in ${Math.round(measured.best)} ms \u2014 slower than the wasm runtime, so using that instead`
        );
      }
    }
    const serialised = (input, imgsz) => serialise(ort, () => run(input, imgsz));
    return Object.assign(serialised, {
      dispose: () => serialise(ort, () => session.release(), "release"),
      providers: executionProviders
    });
  });
}

// view/inference-client.ts
var INFERENCE_WORKER_LOST = "InferenceWorkerLostError";
var InferenceWorkerLostError = class extends Error {
  constructor(why) {
    super(why);
    this.name = INFERENCE_WORKER_LOST;
  }
};
var aborted = () => new DOMException("the model load was cancelled", "AbortError");
var RemoteModel = class {
  constructor(worker) {
    this.worker = worker;
    worker.addEventListener("message", (ev) => this.deliver(ev.data));
    worker.addEventListener("error", (ev) => {
      const said = ev.message;
      this.close(
        `the inference worker failed${typeof said === "string" && said ? `: ${said}` : ""}`
      );
    });
    worker.addEventListener("messageerror", () => {
      this.close("an answer from the inference worker could not be read");
    });
    this.unwatch = documentVisibility.watch(() => {
      this.post({ kind: "visibility", hidden: documentVisibility.hidden() });
    });
  }
  worker;
  pending = /* @__PURE__ */ new Map();
  loading = null;
  lost = null;
  nextId = 0;
  unwatch;
  /** Load the model; resolves with the providers it came up on. */
  load(req) {
    return new Promise((resolve, reject2) => {
      this.loading = { resolve, reject: reject2 };
      this.post({ kind: "load", ...req, hidden: documentVisibility.hidden() });
    });
  }
  /** The runner a detector holds: a run is a round trip, and disposing it terminates the worker. */
  runner(providers) {
    const run = (input, imgsz) => this.run(input, imgsz);
    return Object.assign(run, {
      dispose: async () => {
        this.close("the model was released");
      },
      providers
    });
  }
  /**
   * One frame. The input is TRANSFERRED, which detaches it here — as onnxruntime's own proxy always
   * did on the wasm path, so no caller could rely on keeping it. A view that does not own its
   * buffer outright is copied first rather than detaching a stranger's memory (`transferable`).
   */
  run(input, imgsz) {
    if (this.lost) return Promise.reject(this.lost);
    const id = ++this.nextId;
    return new Promise((resolve, reject2) => {
      this.pending.set(id, { resolve, reject: reject2 });
      const tensor = transferable(input);
      if (!this.post({ kind: "run", id, input: tensor, imgsz }, [tensor.buffer])) {
        this.pending.delete(id);
        reject2(this.lost ?? new InferenceWorkerLostError("the frame could not be sent"));
      }
    });
  }
  /**
   * Give the worker back: terminate it, and reject everything still waiting on it. Idempotent.
   *
   * The ONE place the worker ends, whether the page released it or it failed, so there is no path
   * on which a run is left waiting on a worker that no longer exists.
   */
  close(why) {
    if (this.lost) return;
    const lost = new InferenceWorkerLostError(why);
    this.lost = lost;
    this.worker.terminate();
    this.unwatch();
    const loading = this.loading;
    this.loading = null;
    loading?.reject(lost);
    const waiting = [...this.pending.values()];
    this.pending.clear();
    for (const w of waiting) w.reject(lost);
  }
  /** Post, or close the worker and say false if the post was refused. */
  post(message, transfer = []) {
    if (this.lost) return false;
    try {
      this.worker.postMessage(message, transfer);
      return true;
    } catch (err) {
      this.close(
        `the inference worker could not be sent a message: ${err instanceof Error ? err.message : String(err)}`
      );
      return false;
    }
  }
  deliver(reply) {
    if (this.lost) return;
    if (reply.kind === "loaded" || reply.kind === "load-failed") {
      const loading = this.loading;
      this.loading = null;
      if (reply.kind === "loaded") loading?.resolve(reply.providers);
      else loading?.reject(new Error(reply.error));
      return;
    }
    const waiting = this.pending.get(reply.id);
    if (!waiting) return;
    this.pending.delete(reply.id);
    if (reply.kind === "run-failed") {
      waiting.reject(Object.assign(new Error(reply.error), { name: reply.name }));
      return;
    }
    const { data, anchors, rows } = reply;
    if (!(data instanceof Float32Array) || !Number.isInteger(anchors) || anchors <= 0 || rows !== DETECT_ROWS || data.length !== rows * anchors) {
      waiting.reject(
        new Error(
          `the inference worker answered with ${data instanceof Float32Array ? `${data.length} floats` : "no tensor"} as [1, ${rows}, ${anchors}], which is not a ${DETECT_ROWS}-row detect head`
        )
      );
      return;
    }
    waiting.resolve({ data, anchors, rows });
  }
};
var InferenceOffload = class {
  constructor(onPage = createModelRunner) {
    this.onPage = onPage;
  }
  onPage;
  /** Set once the worker path has failed where the page's thread did not, so it is not tried again. */
  broken = false;
  /** Whether the next load will go to a worker. Read off the globals, which is what lets a test take them away. */
  get offloading() {
    return !this.broken && typeof globalThis.Worker === "function";
  }
  /**
   * Load the model and hand back its runner.
   *
   * `modelUrl` is resolved against the DOCUMENT before it crosses: a worker resolves a relative URL
   * against its own script, which lives in `vendor/`, so './vendor/cubedet.onnx' would become
   * 'vendor/vendor/cubedet.onnx' there.
   */
  async createRunner(modelUrl, opts) {
    const { signal, ...runtime } = opts;
    if (signal?.aborted) throw aborted();
    const worker = this.offloading ? this.spawn() : null;
    if (!worker) return this.onPage(modelUrl, runtime);
    const remote = new RemoteModel(worker);
    const cancel = () => remote.close("the model load was cancelled");
    signal?.addEventListener("abort", cancel, { once: true });
    try {
      const providers = await remote.load({
        modelUrl: new URL(modelUrl, globalThis.document?.baseURI).href,
        wasmPaths: runtime.wasmPaths,
        ortUrl: runtime.ortUrl,
        ...runtime.numThreads === void 0 ? {} : { numThreads: runtime.numThreads }
      });
      return remote.runner(providers);
    } catch (workerErr) {
      remote.close("the model did not load in the inference worker");
      if (signal?.aborted) throw aborted();
      const runner = await this.onPage(modelUrl, runtime);
      this.broken = true;
      console.warn(
        "[cubus] the inference worker could not load the model and the page could, so the model runs on the page from now on \u2014 releasing it will not return its memory",
        workerErr
      );
      return runner;
    } finally {
      signal?.removeEventListener("abort", cancel);
    }
  }
  spawn() {
    try {
      return new Worker(new URL("./inference-worker.js", import.meta.url), { type: "module" });
    } catch (cause) {
      console.warn(
        "[cubus] the inference worker could not be built, so the model runs on the page \u2014 releasing it will not return its memory",
        cause
      );
      this.broken = true;
      return null;
    }
  }
};

// view/letterbox-protocol.ts
function handleLetterboxRequest(request) {
  const pre = preprocess(request.frame, IMG_SIZE);
  return { id: request.id, data: pre.data, imgsz: pre.imgsz, frame: request.frame };
}

// view/letterbox-client.ts
function canOffload() {
  const page = globalThis;
  return typeof page.Worker === "function" && typeof page.createImageBitmap === "function" && typeof page.OffscreenCanvas === "function";
}
function notYetSnapshottable(err) {
  return err instanceof DOMException && err.name === "InvalidStateError";
}
var LetterboxOffload = class {
  worker = null;
  /** Set once a worker has proved it cannot be had at all, so no later request builds another. */
  broken = false;
  /** Whether the current worker has ever answered — the test that makes `broken` safe to set. */
  spoke = false;
  nextId = 0;
  waiting = null;
  /** Whether the next `prepare` will go to a worker. */
  get offloading() {
    return !this.broken && canOffload();
  }
  /**
   * Letterbox the video's current picture off the page's thread, or on it when there is no other.
   *
   * `fallback` reads the pixels on the page — the caller's `grab()`, with its liveness checks — and
   * is what a page without the worker path runs. It is NOT what a worker that dies mid-frame runs:
   * that tick fails loud, as any failed tick does, and the next one falls back.
   *
   * THE SLOT IS TAKEN BEFORE THE FIRST AWAIT (2026-09-21). `waiting` used to be set only after
   * `createImageBitmap` had resolved, so two calls could both pass the one-request guard, both
   * post, and the second overwrite the first's slot — whose promise then never settled. The
   * answer returned here is the SLOT's promise, so a request stranded while the engine is still
   * taking the snapshot is answered the moment it is stranded, not when the snapshot lands; the
   * snapshot itself runs on the side (`snapshot`) and is what re-checks the worker afterwards.
   */
  async prepare(video, fallback) {
    const worker = this.offloading ? this.spawn() : null;
    if (!worker) return this.onThread(fallback);
    if (this.waiting) throw new Error("letterbox: a frame is already being prepared");
    const id = ++this.nextId;
    let slot;
    const answer = new Promise((resolve, reject2) => {
      slot = { id, resolve, reject: reject2 };
    });
    this.waiting = slot;
    void this.snapshot(video, worker, slot);
    return answer;
  }
  /**
   * Take the picture and hand it to `worker` under `slot`, unless the slot was stranded meanwhile.
   *
   * The worker is re-checked AFTER the await: a `dispose()` or a worker death landing during the
   * snapshot has already stranded this request, and posting the bitmap to a terminated worker —
   * which discards its queue — would have left the request installed and unanswerable. A
   * superseded snapshot's bitmap is the one resource nothing else will release, so it is closed
   * here; so is one a failed post could not transfer.
   */
  async snapshot(video, worker, slot) {
    let bitmap;
    try {
      bitmap = await createImageBitmap(video);
    } catch (err) {
      if (this.waiting !== slot) return;
      this.waiting = null;
      slot.reject(
        notYetSnapshottable(err) ? new FrameNotReadyError("the video has no picture to snapshot yet") : err
      );
      return;
    }
    if (this.worker !== worker || this.waiting !== slot) {
      bitmap.close();
      return;
    }
    const job = { id: slot.id, bitmap };
    try {
      worker.postMessage(job, [bitmap]);
    } catch (err) {
      bitmap.close();
      this.waiting = null;
      slot.reject(err);
    }
  }
  /**
   * The page-thread path on its own, for a caller that must not take a bitmap: a source with no
   * `FrameSource.ready` answers its liveness at `grab()` and nowhere else (2026-09-21).
   */
  onThread(fallback) {
    return { ...handleLetterboxRequest({ id: 0, frame: fallback() }), owned: false };
  }
  /**
   * Abandon the frame in flight, if any, and keep the worker: what a `stop()` mid-frame wants.
   * The caller of that frame is told; a bitmap still being snapshotted for it is closed when it
   * arrives (see `prepare`); a reply the worker still sends for it is dropped by its id.
   */
  cancel(why = "letterbox: the frame was abandoned") {
    this.strand(why);
  }
  /** Give the worker back. A client is usable again afterwards; it simply spawns a new one. */
  dispose() {
    this.worker?.terminate();
    this.worker = null;
    this.spoke = false;
    this.strand("letterbox: the worker was disposed");
  }
  spawn() {
    if (this.worker) return this.worker;
    try {
      const spawned = new Worker(new URL("./letterbox-worker.js", import.meta.url), {
        type: "module"
      });
      spawned.addEventListener("message", (ev) => {
        if (this.worker !== spawned) return;
        this.spoke = true;
        this.deliver(ev.data);
      });
      spawned.addEventListener("error", (ev) => {
        if (this.worker !== spawned) return;
        this.failed(ev);
      });
      spawned.addEventListener("messageerror", (ev) => {
        if (this.worker !== spawned) return;
        this.failed(ev);
      });
      this.worker = spawned;
      return spawned;
    } catch (cause) {
      console.warn(
        "letterbox-client: the letterbox worker could not be built, so frames are prepared on this thread",
        cause
      );
      this.broken = true;
      return null;
    }
  }
  deliver(reply) {
    if ("error" in reply && reply.fatal) {
      console.warn(
        `letterbox-client: the letterbox worker cannot letterbox here (${reply.error}), so frames are prepared on this thread`
      );
      this.broken = true;
      this.worker?.terminate();
      this.worker = null;
      this.spoke = false;
      this.strand(`letterbox worker: ${reply.error}`);
      return;
    }
    const waiting = this.waiting;
    if (!waiting || waiting.id !== reply.id) return;
    this.waiting = null;
    if ("error" in reply) {
      waiting.reject(new Error(`letterbox worker: ${reply.error}`));
      return;
    }
    waiting.resolve({ data: reply.data, imgsz: reply.imgsz, frame: reply.frame, owned: true });
  }
  failed(cause) {
    if (!this.spoke) this.broken = true;
    console.warn(
      "letterbox-client: the letterbox worker failed, so frames are prepared on this thread",
      cause
    );
    this.worker?.terminate();
    this.worker = null;
    this.spoke = false;
    this.strand("letterbox: the worker failed while preparing a frame");
  }
  /** The frame in flight, if any, is lost with its worker: its caller is told so rather than left waiting. */
  strand(why) {
    const stranded = this.waiting;
    this.waiting = null;
    stranded?.reject(new Error(why));
  }
};

// view/web-detector.ts
var inference = new InferenceOffload();
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
  video;
  modelUrl;
  source = null;
  run = null;
  /**
   * The letterbox, on another thread where the page can give it one (2026-09-20). `preprocess` on a
   * 720p frame measured 14 ms median, 7–94 ms spread, on every tick of the page's thread; the pixel
   * readback before it is a 3.7 MB copy on the same thread. Both go to `letterbox-worker.js` when
   * the page has `Worker`, `createImageBitmap` and `OffscreenCanvas`, and stay here otherwise —
   * the same tensor either way, because both run `handleLetterboxRequest`.
   */
  letterbox = new LetterboxOffload();
  /** Aborted by `dispose()`, so a load in flight terminates its worker at once. */
  loadAbort = null;
  /**
   * The error the installed runner's worker was lost with, once it has been — see `next`. Kept so
   * EVERY later tick fails with it rather than with "model not loaded": the panel reads the name of
   * the failure its ticks end on (`tickFail`), and only this one tells it to rebuild the model.
   */
  lostWith = null;
  /** The model URL `run` was built for — see `load`. */
  loadedUrl = null;
  /** A `load()` still in flight, so a second caller waits on it rather than building a rival. */
  loading = null;
  /** Which model URL that in-flight load is building — see `load`. */
  loadingUrl = null;
  /**
   * Bumped by `dispose()`, so a load still in flight cannot install its runner afterwards.
   *
   * A discarded detector that adopts a late runner holds an InferenceSession — a wasm heap or a GPU
   * device — that nothing can reach to release, which is the leak the whole park exists to close.
   * It is reachable exactly where the park is: a panel that disconnects during the 1-5 s model load
   * and a detector that loses the park race are both disposed with a load out.
   */
  loadGeneration = 0;
  opening = null;
  get device() {
    return this.source?.device ?? null;
  }
  /**
   * The model URL the installed runner was built for, or null when nothing is installed.
   *
   * Read off `run` and not off `loadedUrl` alone, so the answer cannot outlive the session it is
   * about: `dispose()` clears both, but a future path that released the runner without clearing
   * the URL would otherwise keep claiming a model this detector no longer holds — and this value
   * is what `CameraSession.park()` hands to the next owner as permission to skip `load()`.
   */
  get loadedModel() {
    return this.run ? this.loadedUrl : null;
  }
  /**
   * The provider list the loaded runner was created with, or null before the model has loaded.
   *
   * What was ASKED FOR, which is what the timing fallback changes — never a claim about which
   * provider executed each node. `ModelRunner.providers` documents the distinction at length.
   * A provider may be given as an object with a name, so it is reduced to names here.
   */
  get providers() {
    const run = this.run;
    if (!run) return null;
    return run.providers.map((p) => typeof p === "string" ? p : p.name);
  }
  /**
   * Point this detector at a different owner's `<video>` and model URL.
   *
   * The park (see `pickDetector`) hands one detector to a second `<ai-scan-panel>` so the page
   * keeps ONE InferenceSession across screen visits — and the getters this was built with close
   * over the FIRST panel's shadow root. Without this the reused detector would open a camera into
   * a detached video element nobody can see, which is a scan that works everywhere except on
   * screen. `load()` notices the model URL changing on its own.
   */
  retarget(source) {
    this.video = source.video;
    this.modelUrl = source.modelUrl;
  }
  /**
   * Open a camera, and install it only if this attempt is still the current one.
   *
   * THE COMPLETION BOUNDARY IS ITS OWN RACE (2026-09-05). `openCamera` releases the stream itself
   * while it is still opening, so a `stop()` during the await was always safe — but once it has
   * RESOLVED it has removed its abort listener, and the window between that resolution and this
   * function resuming is a plain microtask nothing guarded. A `stop()` landing there aborted a
   * controller nobody was listening to any more, found `source` still null, and returned; this then
   * assigned the live stream onto a detector the caller had just stopped. The lens stayed on, the
   * `Detector.use` contract ("a stop() while it is pending releases the camera and rejects") was
   * broken in exactly the case it was written for, and nothing said so.
   *
   * `this.opening` is the identity to check, not merely the signal: every way to supersede this
   * attempt — `stop()`, `dispose()`, a newer `use()` — goes through `stop()`, which both aborts
   * this controller and clears the field. The signal is checked too because it costs nothing and
   * the two are independent statements.
   */
  async use(opts = {}) {
    this.stop();
    const opening2 = new AbortController();
    this.opening = opening2;
    try {
      const source = await openCamera(this.video(), opts, opening2.signal);
      if (this.opening !== opening2 || opening2.signal.aborted) {
        source.stop();
        throw new DOMException("camera open superseded", "AbortError");
      }
      this.source = source;
    } finally {
      if (this.opening === opening2) this.opening = null;
    }
  }
  /**
   * Load the model, ONCE per model URL.
   *
   * Two guards, and both are the same lesson from different directions — a session is the most
   * expensive thing this class owns, so nothing may build a second one by accident:
   *
   *   - IN FLIGHT. `if (this.run) return` only catches a load that has FINISHED. Two overlapping
   *     calls — the panel's slow-load timeout abandoning the wait and the user pressing Start —
   *     both saw a null `run` and both created a session, and the first one to finish was then
   *     unreachable for the life of the page.
   *   - PER URL. A parked detector can be handed to an owner with a different `modelUrl`, and
   *     returning early there would silently keep serving the previous owner's model. The old
   *     runner is released before the new one is built.
   *
   * AND THE TWO HAVE TO BE ASKED TOGETHER (2026-09-05). The in-flight guard answered every caller
   * with the pending promise whatever URL they had asked for, so the per-URL rule held only when
   * nothing overlapped: `retarget()` to model B while A was still loading resolved SUCCESSFULLY
   * with A installed, and `loadedUrl` then said A while the owner believed B. Reachable through the
   * park, which is where a detector changes owner and model URL at once. A different URL waits for
   * the load in flight and then starts its own — and re-asks, since by then the answer may have
   * arrived or the target may have moved again.
   *
   * AND THE WAIT IS A PLACE A DETECTOR CAN DIE (2026-09-05). That queue re-enters this method after
   * the await, at which point `loadModel` reads the generation AS IT IS THEN — so a `dispose()`
   * while a load for B sat behind a load for A started B's session on a discarded detector and
   * installed it, which is the very leak `loadGeneration` exists to close, arriving through the
   * door the URL guard had just opened. The generation is therefore captured BEFORE the wait and
   * re-checked after it, so a queued load is invalidated exactly as an in-flight one is. A `load()`
   * called AFTER the dispose still starts a real one — that is a new caller, not a stale queue.
   *
   * AND THE IN-FLIGHT QUESTION IS ASKED FIRST (2026-09-05). The installed-model shortcut used to
   * run before it, which reads as an obvious cheap-test-first ordering and is wrong in exactly the
   * case the two guards were combined for: with A INSTALLED and B loading, a caller asking for A
   * was told "already loaded" and returned — and B then replaced A underneath it, so the last
   * caller to ask ended up on a model nobody had asked it for. What is installed is only an answer
   * while nothing is about to change it, so the pending load is settled first and the shortcut is
   * re-asked afterwards.
   */
  async load() {
    const modelUrl = this.modelUrl();
    if (this.loading) {
      if (this.loadingUrl === modelUrl) return this.loading;
      const generation = this.loadGeneration;
      await this.loading.catch(() => {
      });
      if (generation !== this.loadGeneration) return;
      return this.load();
    }
    if (this.run && this.loadedUrl === modelUrl) return;
    const pending = this.loadModel(modelUrl).finally(() => {
      if (this.loading === pending) {
        this.loading = null;
        this.loadingUrl = null;
      }
    });
    this.loading = pending;
    this.loadingUrl = modelUrl;
    return pending;
  }
  async loadModel(modelUrl) {
    const generation = this.loadGeneration;
    const outgoing = this.run;
    if (outgoing) {
      this.run = null;
      this.loadedUrl = null;
      await outgoing.dispose().catch(() => {
      });
      if (generation !== this.loadGeneration) return;
    }
    const wasmPaths = new URL(".", new URL(modelUrl, document.baseURI)).href;
    const ortUrl = `${wasmPaths}ort.mjs`;
    const abort = new AbortController();
    this.loadAbort = abort;
    let run;
    try {
      run = await inference.createRunner(modelUrl, {
        wasmPaths,
        ortUrl,
        signal: abort.signal
      });
    } catch (err) {
      if (generation !== this.loadGeneration) return;
      throw err;
    } finally {
      if (this.loadAbort === abort) this.loadAbort = null;
    }
    if (generation !== this.loadGeneration) {
      void run.dispose().catch(() => {
      });
      return;
    }
    this.run = run;
    this.loadedUrl = modelUrl;
    this.lostWith = null;
  }
  /**
   * The model output for a fresh frame, or null when there is none to read.
   *
   * A TICK THE WORLD MOVED UNDER ANSWERS NULL (2026-09-21). The camera and the runner are read
   * once, before the first await, and re-checked after it: `stop()`, `dispose()` and a `load()`
   * for another model all replace them while a frame is out — `loadModel` releases the outgoing
   * runner through a null `run`, which the continuation used to dereference (a TypeError on a
   * detector doing exactly what it was told), or it ran the frame through whichever runner had
   * arrived meanwhile. Null and not an error, because the contract's null is "nothing to infer
   * this tick, ask again", and that is what a superseded tick is: the camera or the model it was
   * asked against no longer exists, and the next tick asks against the current ones. A rejection
   * would start the panel's failure clock over a detector that is working — and for a `stop()`
   * the panel discards the tick by its epoch anyway.
   */
  async next() {
    if (!this.source) throw new Error("no camera open \u2014 call use() first");
    if (!this.run) throw this.lostWith ?? new Error("model not loaded \u2014 call load() first");
    const source = this.source;
    const run = this.run;
    const superseded = () => this.source !== source || this.run !== run;
    let pre;
    const frameId = source.frameId?.() ?? null;
    try {
      if (source.ready) {
        source.ready();
        pre = await this.letterbox.prepare(this.video(), () => source.grab());
      } else {
        pre = this.letterbox.onThread(() => source.grab());
      }
    } catch (err) {
      if (superseded()) return null;
      if (err instanceof FrameNotReadyError) return null;
      throw err;
    }
    if (superseded()) return null;
    let output;
    try {
      output = await run(pre.data, pre.imgsz);
    } catch (err) {
      if (superseded()) return null;
      if (err instanceof Error && err.name === INFERENCE_WORKER_LOST && this.run === run) {
        this.run = null;
        this.loadedUrl = null;
        this.lostWith = err;
      }
      throw err;
    }
    const { frame } = pre;
    return {
      ...output,
      ...frameId === null ? {} : { frameId },
      frame: pre.owned ? frame : { data: new Uint8ClampedArray(frame.data), width: frame.width, height: frame.height }
    };
  }
  cameras() {
    return listCameras();
  }
  stop() {
    this.opening?.abort();
    this.opening = null;
    this.source?.stop();
    this.source = null;
    this.letterbox.cancel("letterbox: the camera was stopped mid-frame");
  }
  dispose() {
    this.stop();
    this.loadGeneration++;
    this.loading = null;
    this.loadingUrl = null;
    this.loadAbort?.abort();
    this.loadAbort = null;
    this.lostWith = null;
    const run = this.run;
    this.run = null;
    this.loadedUrl = null;
    void run?.dispose().catch(() => {
    });
    this.letterbox.dispose();
  }
};

// view/pick-detector.ts
var parked = null;
var PARKED_RELEASE_MS = 6e4;
var releaseTimer = null;
function cancelRelease() {
  if (releaseTimer !== null) clearTimeout(releaseTimer);
  releaseTimer = null;
}
function parkDetector(choice) {
  choice.detector.stop();
  if (parked && parked.detector !== choice.detector) {
    choice.detector.dispose?.();
    return;
  }
  parked = choice;
  cancelRelease();
  if (choice.runtime !== "web") return;
  releaseTimer = setTimeout(() => {
    releaseTimer = null;
    if (parked === choice) disposeParkedDetector();
  }, PARKED_RELEASE_MS);
}
function parkedDetector() {
  return parked;
}
function disposeParkedDetector() {
  cancelRelease();
  const kept = parked;
  parked = null;
  kept?.detector.dispose?.();
  kept?.detector.stop();
}
var PROBE = `${CUBE_VISION}probe`.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
var NOT_REGISTERED = [
  // `Command plugin:cube-vision|probe not found`
  new RegExp(`(?:^|\\s)(?:command\\s+)?${PROBE}\\s+not found\\b`, "i"),
  // `unknown command: plugin:cube-vision|probe`
  new RegExp(`unknown command:?\\s+${PROBE}\\b`, "i")
];
function absentCommand(err) {
  const text = typeof err === "string" ? err : err?.message ?? "";
  return NOT_REGISTERED.some((shape) => shape.test(text));
}
async function pickDetector(opts) {
  const kept = parked;
  if (kept) {
    parked = null;
    cancelRelease();
    kept.detector.retarget?.(opts);
    const wanted = opts.modelUrl();
    if (kept.modelLoaded && kept.modelUrl !== wanted) {
      return { detector: kept.detector, runtime: kept.runtime, modelLoaded: false, modelUrl: null };
    }
    return kept;
  }
  const invoke = globalThis.__TAURI__?.core?.invoke;
  if (invoke) {
    try {
      if (await invoke(`${CUBE_VISION}probe`) === true) {
        return {
          detector: new NativeDetector(invoke),
          runtime: "native",
          modelLoaded: false,
          modelUrl: null
        };
      }
    } catch (err) {
      (absentCommand(err) ? console.info : console.warn)(
        `[cubus] no native cube-vision runtime \u2014 using the browser one${absentCommand(err) ? "" : " after an unexpected failure"}`,
        err
      );
    }
  }
  return {
    detector: new WebDetector(opts.video, opts.modelUrl),
    runtime: "web",
    modelLoaded: false,
    modelUrl: null
  };
}

// view/camera-session.ts
var CameraSession = class {
  detectorPromise = null;
  detector = null;
  /**
   * Did this session's detector come from `pickDetector`, i.e. may it go back to the page's park?
   *
   * An INJECTED one may not. `use()` is the test seam and the native host's, and a fake handed in
   * by one case must never reach a page-wide slot where the next case would be given it — the
   * failure mode is a suite that passes alone and fails in a file.
   */
  parkable = false;
  timer = null;
  generation = 0;
  epoch = 0;
  /** Bumped by `use()`, so an injection beats a probe that is still in flight. See `use`. */
  detectorChoice = 0;
  /**
   * The open chain, and WHOSE it is.
   *
   * `tail` is the `detector.use()` still in flight, so the next one queues behind it (see `open`);
   * `count` is how many `open()` calls are queued or inside the detector right now — a count and
   * not a boolean, because the chain serialises opens rather than rejecting them and three can be
   * waiting at once. `park()` is the only reader of the count; see there for why handing the
   * detector to the page while one is still out makes a cross-owner camera kill possible.
   *
   * KEYED ON THE DETECTOR, because an ordering constraint between two DIFFERENT detectors is not
   * one (2026-09-05). The chain outlived the object it was about, so a `use()` that replaced the
   * detector — the test seam, and the native host's — left the new one queued behind the old one's
   * pending permission prompt, which a user who never answers leaves pending forever. The
   * replacement is discarded and stopped by then, so there is nothing left for its queue to order:
   * a new detector starts a new chain, and the old links still decrement the record they were
   * registered on rather than an unrelated counter.
   */
  opens = null;
  /**
   * The owner's model-URL getter, kept as the FALLBACK label for a runtime that has no URL.
   *
   * `modelLoaded` on its own is a claim with no subject, and the park is where the subject changes
   * — see `DetectorChoice.modelUrl`. This used to BE the subject, read at park time, and that was
   * the defect: it is the URL the owner is asking for NOW, which is not the one that was compiled.
   * See `modelHeldBy`, which asks the detector instead and falls back to this only where the
   * detector answers to no URL at all.
   */
  modelUrlOf = null;
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
    this.parkable = false;
    this.detectorPromise = Promise.resolve(detector);
    this.runtime = runtime;
    this.modelLoaded = false;
    this.device = null;
  }
  /**
   * Hand the detector back to the page, so the next mount reuses its session and its model.
   *
   * Called when the OWNER goes away — `<ai-scan-panel>`'s disconnectedCallback — and not from
   * `close()`, which runs on every `stop()` and would give the detector away while the same panel
   * still intends to scan with it. `parkDetector` stops the camera; the model survives.
   *
   * The session forgets it either way: a parked detector is no longer this session's to drive, and
   * a later `ensureDetector()` must ask the page for one afresh rather than resolve a promise
   * holding the one it gave back. Forgetting includes BUMPING `detectorChoice`: clearing
   * `detectorPromise` alone left a `pickDetector` probe still in flight free to land afterwards and
   * install its detector on a session that has already given its one away — and `chosen` and the
   * cached promise then pointed at different objects, with the loser's camera and model held by
   * nothing that could release them. (2026-09-05.)
   *
   * THE HANDOVER WAITS FOR THE OPEN. `close()` above supersedes this session's attempts, so a
   * `detector.use()` still inside the detector will call `detector.stop()` on its way out — see
   * `open`'s finally, which is right while this session owns the detector and catastrophic once it
   * does not. Hand it to the page immediately and the next `<ai-scan-panel>` can take it, open its
   * camera, and have the old link's cleanup close the lens under it. Nothing in the chain is a
   * cross-session ordering constraint — each session has its own — so the wait is the only thing
   * that can express one. The cost when it fires is a park that lands late, so a re-mount inside
   * that window builds its own detector rather than reusing this one; a rebuilt session is a cost,
   * a camera killed by its predecessor is a fault.
   */
  park() {
    this.close();
    const detector = this.detector;
    const parkable = this.parkable;
    this.detector = null;
    this.detectorPromise = null;
    this.detectorChoice++;
    this.parkable = false;
    const runtime = this.runtime;
    const modelLoaded = this.modelLoaded;
    const modelUrl = modelLoaded && detector ? this.modelHeldBy(detector) : null;
    this.modelLoaded = false;
    this.modelUrlOf = null;
    if (!(detector && parkable && runtime)) return;
    const queue = detector && this.opens?.detector === detector ? this.opens : null;
    this.opens = null;
    const handOver = () => parkDetector({ detector, runtime, modelLoaded, modelUrl });
    if (!queue || queue.count === 0) handOver();
    else void queue.tail.then(handOver, handOver);
  }
  /**
   * WHICH model the detector actually holds — asked of the DETECTOR, which is the only thing that
   * knows (2026-09-05).
   *
   * `park()` used to read the owner's `modelUrl` getter here, and that is a different fact wearing
   * the same name: it is the URL this panel is asking for at the moment it disconnects, not the one
   * that was compiled into the session. The two come apart in exactly the place the park matters —
   * a host that changes its `model-url` attribute after the load — and the failure is silent:
   * model A was parked under B's name, `pickDetector` compared B against B, and the next mount was
   * told its model was ready while what is compiled is A. A wrong model produces readings, not
   * errors. Reproduced.
   *
   * `undefined` from the detector is "I do not answer to a URL", and only there does the owner's
   * getter stand in: the native plugin resolves and compiles the bundled model itself, so its
   * identity cannot disagree with itself and the URL is a label rather than a claim. `null` is the
   * detector saying it holds nothing, and is passed through as that.
   */
  modelHeldBy(detector) {
    const stated = detector.loadedModel;
    return stated === void 0 ? this.modelUrlOf?.() ?? null : stated;
  }
  /**
   * The detector, chosen once and kept for the session's life, so the model survives a stop()/
   * start() and the native probe runs only once. Cached as a promise because the choice is async.
   *
   * AND `modelLoaded` IS RE-ASKED EVERY TIME, because it is a claim about a MODEL and this is
   * where the model can change (2026-09-05). The park had this covered — `pickDetector` compares
   * the parked URL against the new owner's — but the cached path had nothing: the same owner
   * re-pointing its `model-url` between a stop and a start kept a flag that was about the previous
   * URL, so the panel skipped `load()` and scanned model A while every screen said B. A wrong
   * model produces readings, not errors. Same comparison as the park's, for the same reasons: the
   * detector is asked (`modelHeldBy`), the strings are compared as the owners' getters produce
   * them, and a false mismatch costs one call to an idempotent `load()` while a false match costs
   * the scan.
   */
  ensureDetector(video, modelUrl) {
    this.modelUrlOf = modelUrl;
    if (this.modelLoaded && this.detector && this.modelHeldBy(this.detector) !== modelUrl()) {
      this.modelLoaded = false;
    }
    if (this.detectorPromise === null) {
      const choice = this.detectorChoice;
      this.detectorPromise = pickDetector({ video, modelUrl }).then(
        ({ detector, runtime, modelLoaded }) => {
          if (choice !== this.detectorChoice) {
            detector.dispose?.();
            detector.stop();
            return this.detector ?? detector;
          }
          this.detector = detector;
          this.parkable = true;
          this.runtime = runtime;
          this.modelLoaded = modelLoaded;
          return detector;
        }
      );
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
      clearTimeout(this.timer);
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
   *
   * A RE-ARMED TIMEOUT, not an interval, because the cadence is a function rather than a constant:
   * the panel ticks as fast as the runtime it actually got can answer, and that is known only
   * after the first inference. `setInterval` fixes its period when it is created, so following a
   * measurement would have meant tearing the loop down and rebuilding it on every change — which
   * bumps the epoch, and an epoch bump mid-scan discards the inference in flight.
   *
   * Re-armed BEFORE the tick runs, so a `stopLoop()` from inside the tick — `scheduleCheck` does
   * exactly that — clears the timer that was just set instead of being overwritten by it.
   */
  beginLoop(delay, tick) {
    this.stopLoop();
    this.epoch++;
    const next = typeof delay === "function" ? delay : () => delay;
    const arm = () => {
      this.timer = setTimeout(
        () => {
          arm();
          tick();
        },
        Math.max(1, next())
      );
    };
    arm();
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
    if (this.opens?.detector !== detector) {
      this.opens = { detector, tail: Promise.resolve(), count: 0 };
    }
    const queue = this.opens;
    queue.count++;
    const run = async () => {
      if (!this.current(token)) return { fellBack: false };
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
    const chained = queue.tail.then(run, run);
    queue.tail = chained.then(
      () => void 0,
      () => void 0
    );
    const done = () => {
      queue.count--;
    };
    void chained.then(done, done);
    return chained;
  }
};

// view/misread-protocol.ts
function handleMisreadRequest(request) {
  return {
    epoch: request.epoch,
    diagnosis: request.fixedRotation ? diagnoseMisread(request.faces, { fixedRotation: true }) : diagnoseAcrossSchemes(request.faces)
  };
}

// view/misread-client.ts
function snapshot(request) {
  const faces = {};
  for (const face of FACES) faces[face] = { colors: [...request.faces[face].colors] };
  return { epoch: request.epoch, faces, fixedRotation: request.fixedRotation };
}
var MisreadDecoder = class {
  worker = null;
  /** Set once a worker has proved it cannot be had at all, so no later request builds another. */
  broken = false;
  /** Whether the current worker has ever answered — the test that makes `broken` safe to set. */
  spoke = false;
  /** The request the worker is actually decoding, or null when it is idle. See `request`. */
  running = null;
  /** The one request waiting for it to come free. A newer ask REPLACES this. See `request`. */
  queued = null;
  /**
   * Ask for `request`'s diagnosis.
   *
   * Returns the answer outright when this page has nowhere else to run it — in which case
   * `answer` is never called and the caller already has everything. Returns null when a worker
   * took the request, and `answer` runs AT MOST once, later, with the reply for this epoch.
   *
   * AT MOST, not exactly (corrected 2026-09-05, having been the stronger claim since this class
   * was written). Three things drop a callback, and all three are deliberate: a newer ask replaces
   * one that has not been posted yet (see below); `dispose()` gives the worker back and forgets
   * what it was holding; and a worker failure answers only the LATEST of the two it was carrying,
   * because the other is already about a cube that is gone. Every one of them means the answer
   * would have been discarded on arrival for its epoch anyway — so a caller must not treat this
   * callback as the thing that CLEARS a "checking…" marker on its own. `ai-scan-panel` does not:
   * every site that supersedes a reading bumps `diagnosisEpoch` and republishes.
   *
   * The request is SNAPSHOT here, not held by reference — see `snapshot`.
   */
  request(request, answer) {
    const worker = this.spawn();
    if (!worker) return handleMisreadRequest(request);
    this.queued = { request: snapshot(request), answer };
    this.dispatch();
    return null;
  }
  /** Give the worker back. A decoder is usable again afterwards; it simply spawns a new one. */
  dispose() {
    this.worker?.terminate();
    this.worker = null;
    this.spoke = false;
    this.running = null;
    this.queued = null;
  }
  /**
   * Post the waiting ask, if the worker is free to take it.
   *
   * Guarded on `running` rather than called only from the idle path, because `answer` may ask for
   * another decode re-entrantly — the panel republishes on a reply, and a host may correct a
   * sticker from that — and two posts in flight is exactly the backlog this class exists to avoid.
   */
  dispatch() {
    if (this.running !== null || this.queued === null || this.worker === null) return;
    const next = this.queued;
    this.queued = null;
    this.running = next;
    this.worker.postMessage(next.request);
  }
  spawn() {
    if (this.worker) return this.worker;
    if (this.broken || typeof Worker === "undefined") return null;
    try {
      const spawned = new Worker(new URL("./misread-worker.js", import.meta.url), {
        type: "module"
      });
      spawned.addEventListener("message", (ev) => {
        if (this.worker !== spawned) return;
        this.spoke = true;
        this.deliver(ev.data);
      });
      spawned.addEventListener("error", (ev) => {
        if (this.worker !== spawned) return;
        this.failed(ev);
      });
      this.worker = spawned;
      return spawned;
    } catch (cause) {
      console.warn(
        "misread-client: the decoder worker could not be built, so it runs on this thread",
        cause
      );
      this.broken = true;
      return null;
    }
  }
  deliver(reply) {
    const waiting = this.running;
    if (!waiting || waiting.request.epoch !== reply.epoch) return;
    this.running = null;
    try {
      waiting.answer(reply);
    } finally {
      this.dispatch();
    }
  }
  failed(cause) {
    if (!this.spoke) this.broken = true;
    console.warn(
      "misread-client: the decoder worker failed, so the reading is checked on this thread",
      cause
    );
    this.worker?.terminate();
    this.worker = null;
    this.spoke = false;
    const stranded = this.queued ?? this.running;
    this.running = null;
    this.queued = null;
    if (stranded) stranded.answer(handleMisreadRequest(stranded.request));
  }
};

// view/scan-trace.ts
var TRACE_KEY = "cubusScanTrace";
var TRACE_CAPACITY = 4e3;
function traceEnabled(store) {
  try {
    const storage = store ?? globalThis.localStorage;
    return storage?.getItem(TRACE_KEY) === "1";
  } catch {
    return false;
  }
}
var IN_VIEW_BOXES = 5;
var CENTRE_CELL = 4;
function filedColours(mark) {
  const colors = mark.detail.colors;
  if (!Array.isArray(colors) || !colors.every((c) => typeof c === "number")) {
    throw new Error(
      `a ${mark.kind} event at ${mark.t} ms carries no colours to measure its side by`
    );
  }
  return colors;
}
function sideSpeeds(ticks, events) {
  const marks = events.filter((e) => e.kind === "captured");
  const out = [];
  let from = Number.NEGATIVE_INFINITY;
  let previous = null;
  for (const m of marks) {
    const filed = filedColours(m);
    const win = ticks.filter((r) => r.t > from && r.t <= m.t);
    from = m.t;
    let lastOfPrevious;
    for (let i = win.length - 1; previous !== null && i >= 0; i--) {
      const colors = win[i].colors;
      if (colors !== void 0 && sameSide(colors, previous)) {
        lastOfPrevious = win[i];
        break;
      }
    }
    const after = lastOfPrevious ? win.filter((r) => r.t > lastOfPrevious.t) : win;
    const start = after.findIndex((r) => r.colors !== void 0 && sameSide(r.colors, filed));
    const own = start < 0 ? [] : after.slice(start);
    const seen = lastOfPrevious ?? win.find((r) => (r.kept ?? 0) >= IN_VIEW_BOXES);
    const firstRead = own[0];
    previous = filed;
    const breaks = { total: 0, abstain: {}, colour: {}, moved: 0 };
    const centre = {};
    for (let i = 1; i < own.length; i++) {
      const prev = own[i - 1];
      const cur = own[i];
      if (prev.colors === void 0) continue;
      if (cur.colors === void 0) {
        count(breaks.abstain, cur.geometry?.rule ?? cur.reason ?? cur.outcome);
        breaks.total += 1;
        continue;
      }
      if (cur.colors[CENTRE_CELL] !== prev.colors[CENTRE_CELL]) {
        count(
          centre,
          `${colourOf2(prev.colors[CENTRE_CELL])}>${colourOf2(cur.colors[CENTRE_CELL])}`
        );
      }
      const changed = [];
      for (let c = 0; c < cur.colors.length; c++) {
        if (cur.colors[c] !== prev.colors[c]) changed.push(c);
      }
      if (changed.length === 0) continue;
      breaks.total += 1;
      if (changed.length === 1) {
        const c = changed[0];
        count(breaks.colour, `cell${c}:${colourOf2(prev.colors[c])}>${colourOf2(cur.colors[c])}`);
      } else breaks.moved += 1;
    }
    out.push({
      side: String(m.detail.face),
      at: m.t,
      waitMs: seen ? m.t - seen.t : null,
      firstReadMs: firstRead ? m.t - firstRead.t : null,
      otherReads: (start < 0 ? after : after.slice(0, start)).filter((r) => r.colors !== void 0).length,
      ticks: own.length,
      reads: own.filter((r) => r.colors !== void 0).length,
      breaks,
      centre
    });
  }
  return out;
}
var EVENT_CAPACITY = 500;
function frameNote(frame) {
  return { kept: frame.kept, near: frame.near, centre: frame.centre, boxes: frame.boxes };
}
var colourOf2 = (cls) => COLOUR_NAMES[cls] ?? `class ${cls}`;
function quantiles(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const at = (q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  const round = (v) => Math.round(v * 10) / 10;
  return { median: round(at(0.5)), p90: round(at(0.9)), max: round(sorted[sorted.length - 1]) };
}
var count = (into, key) => {
  into[key] = (into[key] ?? 0) + 1;
};
var ScanTrace = class {
  constructor(capacity = TRACE_CAPACITY, clock = () => performance.now(), wall = () => (/* @__PURE__ */ new Date()).toISOString()) {
    this.capacity = capacity;
    this.clock = clock;
    this.wall = wall;
  }
  capacity;
  clock;
  wall;
  records = [];
  happenings = [];
  sessions = [];
  session = 0;
  seq = 0;
  start = 0;
  /** A scan loop started: every tick until the next `begin` belongs to it. */
  begin(meta) {
    this.session += 1;
    this.seq = 0;
    this.start = this.clock();
    this.sessions.push({ ...meta, id: this.session, startedAt: this.wall() });
  }
  /** Record one tick. Dropped when no session has begun, rather than filed under a session of 0. */
  record(note) {
    if (this.session === 0) return null;
    const rec = {
      ...note,
      session: this.session,
      seq: this.seq++,
      t: Math.round(this.clock() - this.start)
    };
    this.records.push(rec);
    if (this.records.length > this.capacity) this.records.shift();
    return rec;
  }
  /** Record a decision that is not a frame. Dropped before any session, like a tick. */
  event(kind, detail = {}) {
    if (this.session === 0) return null;
    const ev = {
      session: this.session,
      t: Math.round(this.clock() - this.start),
      kind,
      detail: { ...detail }
    };
    this.happenings.push(ev);
    if (this.happenings.length > EVENT_CAPACITY) this.happenings.shift();
    return ev;
  }
  /** Every event kept, oldest first. Copies, like `dump`. */
  events() {
    return this.happenings.map((e) => ({ ...e, detail: { ...e.detail } }));
  }
  get size() {
    return this.records.length;
  }
  /** Every tick kept, oldest first. A copy, so reading it cannot disturb the recording. */
  dump() {
    return this.records.map((r) => ({ ...r }));
  }
  clear() {
    this.records.length = 0;
    this.happenings.length = 0;
  }
  /**
   * One entry per session, read first. It answers the questions a flickering scan raises, in the
   * order they are worth asking: is the detector slow, how does each frame end, how often did the
   * words change, and — for the logo case — what the detector made of the centre of the face.
   */
  summary() {
    return this.sessions.map((s) => {
      const ticks = this.records.filter((r) => r.session === s.id);
      const outcomes = {};
      const abstain = {};
      const geometry = {};
      const centreClasses = {};
      const centre = { probed: 0, nothingThere: 0, nearMiss: 0, kept: 0 };
      const nearMissConf = [];
      let lineChanges = 0;
      let previousLine;
      for (const r of ticks) {
        count(outcomes, r.outcome);
        if (r.reason) count(abstain, r.reason);
        if (r.geometry) count(geometry, r.geometry.rule);
        if (r.line !== void 0 && previousLine !== void 0 && r.line !== previousLine)
          lineChanges += 1;
        if (r.line !== void 0) previousLine = r.line;
        if (r.centre) {
          centre.probed += 1;
          if (!r.centre.found) centre.nothingThere += 1;
          else {
            centreClasses[colourOf2(r.centre.cls)] = (centreClasses[colourOf2(r.centre.cls)] ?? 0) + 1;
            if (r.centre.kept) centre.kept += 1;
            else {
              centre.nearMiss += 1;
              nearMissConf.push(r.centre.conf);
            }
          }
        }
      }
      const first = ticks[0];
      const last = ticks[ticks.length - 1];
      const seconds = last ? Math.round(last.t / 100) / 10 : 0;
      const span = first && last ? (last.t - first.t) / 1e3 : 0;
      const events = this.happenings.filter((e) => e.session === s.id);
      const sides = sideSpeeds(ticks, events);
      const waits = sides.flatMap((x) => x.waitMs === null ? [] : [x.waitMs]);
      const settles = sides.flatMap((x) => x.firstReadMs === null ? [] : [x.firstReadMs]);
      return {
        session: s.id,
        startedAt: s.startedAt,
        runtime: s.runtime,
        providers: s.providers,
        phase: s.phase,
        ticks: ticks.length,
        // Ticks the ring dropped from this session's start: `seq` counts from 0 per session.
        ticksDropped: first ? first.seq : 0,
        seconds,
        ticksPerSecond: span > 0 ? Math.round((ticks.length - 1) / span * 10) / 10 : null,
        // The speed report: per side, then the whole. Read `sides` first — it says which side was
        // slow and what the time went on.
        speed: {
          floorMs: s.floorMs ?? null,
          sides,
          waitMs: quantiles(waits),
          firstReadMs: quantiles(settles),
          firstSideInViewToLastSideMs: sides.length > 0 && sides[0].waitMs !== null ? sides[sides.length - 1].at - (sides[0].at - sides[0].waitMs) : null
        },
        inferMs: quantiles(ticks.map((r) => r.inferMs)),
        traceMs: quantiles(ticks.flatMap((r) => r.traceMs === void 0 ? [] : [r.traceMs])),
        outcomes,
        abstain,
        geometry,
        lineChanges,
        settled: ticks.filter((r) => r.outcome === "settled").map((r) => ({ t: r.t, colors: (r.colors ?? []).map(colourOf2).join(" ") })),
        centre: { ...centre, classes: centreClasses, nearMissConf: quantiles(nearMissConf) },
        events: events.map((e) => ({ t: e.t, kind: e.kind, ...e.detail }))
      };
    });
  }
};

// view/session-recorder.ts
var RECORD_KEY = "cubusScanRecord";
var RECORD_CAPACITY = 4e3;
function recordEnabled(store) {
  try {
    const storage = store ?? globalThis.localStorage;
    return storage?.getItem(RECORD_KEY) === "1";
  } catch {
    return false;
  }
}
function worthRecording(dets) {
  return dets.filter((d) => d.confidence >= NEAR_FLOOR_RECORD && d.scores !== void 0).map((d) => ({ ...d, scores: [...d.scores] }));
}
var SessionRecorder = class {
  constructor(capacity = RECORD_CAPACITY, clock = () => performance.now(), wall = () => (/* @__PURE__ */ new Date()).toISOString()) {
    this.capacity = capacity;
    this.clock = clock;
    this.wall = wall;
  }
  capacity;
  clock;
  wall;
  start = null;
  startedAt = "";
  t0 = 0;
  frames = [];
  decisions = [];
  dropped = 0;
  /** The id of the last frame recorded, so a re-served one is counted rather than duplicated. */
  lastId = null;
  /** Frames whose source id could not be used because it did not increase — see `frame`. */
  renumbered = 0;
  /** A scan loop started: every frame until the next `begin` belongs to it. */
  begin(start) {
    this.start = start;
    this.startedAt = this.wall();
    this.t0 = this.clock();
    this.frames.length = 0;
    this.decisions.length = 0;
    this.dropped = 0;
    this.lastId = null;
    this.renumbered = 0;
  }
  /**
   * How many frames this recording holds, how many the capacity dropped, and how many carry the
   * recorder's own ordinal because the source's id did not increase (see `frame`).
   *
   * `renumbered` above zero means the recording's ids are not the camera's, so questions about
   * frame identity — how many DISTINCT frames a decision rested on — are answered about the
   * recorder's numbering rather than the camera's. Reported rather than hidden, because a silent
   * substitution here would look exactly like a clean recording.
   */
  get size() {
    return {
      frames: this.frames.length,
      framesDropped: this.dropped,
      renumbered: this.renumbered
    };
  }
  /**
   * Record one tick's detections.
   *
   * `frameId` is the identity D2 put on the seam. A tick served a frame ALREADY RECORDED does not
   * add a second entry — it increments that frame's `served`, which is the one number that makes
   * "how many DISTINCT frames did this decision rest on" answerable at all. A source that cannot
   * identify its frames passes `undefined`, and then every tick is a frame, because that is
   * genuinely all such a source knows.
   */
  frame(dets, options = {}) {
    if (!this.start) return;
    const { frameId, inferMs, pixels } = options;
    const last = this.frames[this.frames.length - 1];
    if (frameId !== void 0 && last && frameId === this.lastId) {
      last.served += 1;
      return;
    }
    const next = last ? last.id + 1 : 0;
    const supplied = frameId !== void 0 && (!last || frameId > last.id);
    if (frameId !== void 0 && !supplied) this.renumbered += 1;
    const id = supplied ? frameId : next;
    this.lastId = frameId ?? null;
    this.frames.push({
      id,
      t: Math.round(this.clock() - this.t0),
      served: 1,
      detections: worthRecording(dets),
      ...inferMs === void 0 ? {} : { inferMs: Math.round(inferMs * 10) / 10 },
      ...pixels === void 0 ? {} : { pixels }
    });
    if (this.frames.length > this.capacity) {
      this.frames.shift();
      this.dropped += 1;
    }
  }
  /**
   * Record something the panel decided, against the frame it decided on.
   *
   * Dropped when no frame has been recorded yet: `parseSession` refuses a decision pointing at a
   * frame the session does not hold, and a recording that wrote one would be a corpus entry no
   * reader will load — a recorder must not be able to produce a file it cannot produce.
   */
  decision(kind, detail = {}) {
    const last = this.frames[this.frames.length - 1];
    if (!this.start || !last) return;
    this.decisions.push({
      frame: last.id,
      t: Math.round(this.clock() - this.t0),
      kind,
      detail: { ...detail }
    });
  }
  /**
   * The finished session, with the cube, the conditions and the truth a PERSON supplied — or null
   * when there is nothing to hand over.
   *
   * Null rather than a partial session for the two cases that cannot be a corpus entry: no
   * recording was begun, and no frame was ever recorded. Both would parse as malformed, and a
   * recorder that emits something a reader refuses is worse than one that says it has nothing.
   *
   * Decisions pointing at frames the capacity has since dropped are pruned here, for the same
   * reason: `parseSession` refuses them, and a long sitting is exactly when the oldest frames go.
   */
  finish(end) {
    if (!this.start || this.frames.length === 0) return null;
    const ids = new Set(this.frames.map((f) => f.id));
    return {
      schema: SESSION_SCHEMA,
      id: this.start.id,
      startedAt: this.startedAt,
      cube: end.cube,
      conditions: { ...end.conditions },
      model: { ...this.start.model },
      truth: { ...end.truth },
      // A DEEP copy, scores included: the session handed out must not alias the recorder's, or a
      // caller that normalises the scores it was given changes what a later `finish()` reports.
      frames: this.frames.map((f) => ({
        ...f,
        detections: f.detections.map((d) => ({ ...d, scores: [...d.scores ?? []] }))
      })),
      decisions: this.decisions.filter((d) => ids.has(d.frame)).map((d) => ({ ...d, detail: { ...d.detail } }))
    };
  }
};

// view/stillness.ts
var SUBJECT_CHANGE = 4;
var CENTRE = 4;
var QUARTER_TURN = [6, 3, 0, 7, 4, 1, 8, 5, 2];
function turnedFrom(prev, next) {
  if (prev.length !== QUARTER_TURN.length || next.length !== QUARTER_TURN.length) return false;
  let turned = prev;
  for (let quarter = 1; quarter <= 3; quarter++) {
    const from = turned;
    turned = QUARTER_TURN.map((i) => from[i]);
    if (turned.every((c, i) => c === next[i])) return true;
  }
  return false;
}
function classify(previous, colors) {
  const differing = [];
  for (let i = 0; i < colors.length; i++) {
    if (colors[i] !== previous[i]) differing.push(i);
  }
  const anotherSide = differing.includes(CENTRE) && differing.length >= 2;
  const turned = differing.length >= 2 && turnedFrom(previous, colors);
  return {
    only: differing.length === 1 ? differing[0] : null,
    forget: differing.length >= SUBJECT_CHANGE || anotherSide || turned
  };
}
var Stillness = class {
  /**
   * @param reads Identical consecutive reads required — all nine stickers, the centre included.
   * @param ms Wall-clock stillness required, from the first read of the current run.
   */
  constructor(reads, ms) {
    this.reads = reads;
    this.ms = ms;
  }
  reads;
  ms;
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
  /** The colours of the run's read, kept so a broken run can be told WHERE it broke. */
  colors = null;
  /**
   * The frame the last counted read came from, or null when none has been counted or the source
   * cannot identify its frames.
   *
   * D2 (`dev-docs/scan-pipeline-audit-2026-09-23.md` §3). The native camera serves its cached frame
   * on every tick for up to a second — sixteen ticks at the native rate — and the browser's
   * `<video>` repeats its last painted frame whenever the loop outruns the stream. Nothing here
   * could tell that from a stream of new frames, so ONE physical frame could satisfy "three
   * identical reads" on its own, and a side was captured on a single observation while the gate
   * reported a run of three.
   */
  lastFrame = null;
  /** Per position, how many times a run has been broken by that position alone. */
  breaks = /* @__PURE__ */ new Map();
  /**
   * Per position, the two colours of its MOST RECENT break — what it is alternating between now.
   *
   * The latest pair, not every colour ever seen (2026-09-23, with D8). While the history was wiped
   * on every abstaining frame it could not grow, so a set and a pair were the same thing; now that
   * it survives, a set would accumulate every colour a sticker had shown all scan and the sentence
   * would name four. The sentence exists to say which TWO colours a sticker is swapping between,
   * and the light remark is added only for a pair the light is known to confuse — a growing set
   * would eventually contain such a pair by accident and attach the remark to a sticker that never
   * showed it.
   */
  breakColours = /* @__PURE__ */ new Map();
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
   *
   * A FRAME ALREADY COUNTED IS NOT COUNTED AGAIN (D2, 2026-09-23). `frameId` identifies the picture
   * the read came from; offering the same one twice advances nothing — not the count, not the
   * centre tally — and the gate's verdict is re-reported from the state the first offer left. The
   * DURATION still runs, because wall-clock time passing is real whether or not the camera
   * delivered; what a repeated frame cannot do is stand in for a second look at the cube.
   *
   * `undefined` means the source cannot identify its frames, and is counted exactly as before —
   * a runtime that does not know must not have an answer invented for it, since a fabricated id
   * reads as "always a new frame", which is the belief this corrects.
   */
  offer(colors, now = performance.now(), frameId) {
    const key = colors.join(",");
    if (frameId !== void 0 && frameId === this.lastFrame) {
      return this.count >= this.reads && now - this.since >= this.ms;
    }
    if (frameId !== void 0) this.lastFrame = frameId;
    if (key === this.key) {
      this.count += 1;
    } else {
      const previous = this.colors;
      if (previous && previous.length === colors.length) {
        const { only, forget } = classify(previous, colors);
        if (forget) {
          this.breaks.clear();
          this.breakColours.clear();
        }
        if (only !== null) {
          this.breaks.set(only, (this.breaks.get(only) ?? 0) + 1);
          this.breakColours.set(only, [previous[only], colors[only]]);
        }
      }
      this.key = key;
      this.count = 1;
      this.since = now;
    }
    this.colors = [...colors];
    return this.count >= this.reads && now - this.since >= this.ms;
  }
  /**
   * The one position that keeps breaking the run on its own, or null.
   *
   * `atLeast` breaks before it is reported, so a single unlucky frame is not narrated at the user.
   * When several positions qualify the noisiest wins — naming one sticker is the whole value, and
   * a list of three is the same "hold still" with more words.
   */
  flickering(atLeast = 3) {
    let best = null;
    let most = atLeast - 1;
    for (const [index, count2] of this.breaks) {
      if (count2 > most) {
        most = count2;
        best = index;
      }
    }
    return best;
  }
  /**
   * The colours `position` showed across the breaks it made alone, ascending — what the sticker
   * keeps changing BETWEEN. Two colours is the case worth a sentence: a pair the detector confuses
   * under some light. Empty for a position that never broke a run alone.
   */
  flickerColours(position) {
    return [...new Set(this.breakColours.get(position) ?? [])].sort((a, b) => a - b);
  }
  /**
   * Where the current run stands, for the scan trace. Read-only, and never consulted by `offer`:
   * the gate decides from its own fields, so recording this cannot change what it decides. `heldMs`
   * is measured the same way the gate measures it — from the run's FIRST read, on the same clock.
   */
  status(now = performance.now()) {
    return { run: this.count, heldMs: this.key === null ? 0 : now - this.since };
  }
  /**
   * Forget the current RUN — the cube left the frame, a frame could not be read, the read was spent.
   *
   * THE FLICKER HISTORY SURVIVES IT (D8, `dev-docs/scan-pipeline-audit-2026-09-23.md` §3). The panel
   * resets on every abstaining frame, and a side that will not settle abstains constantly — so
   * wiping `breaks` here meant "which sticker keeps changing" could never reach the three breaks
   * `flickering()` asks for, and the one specific thing the scan can tell a person was replaced by
   * "hold still" for as long as they were willing to hold it. The history is about a SUBJECT, not
   * about a run: `classify`'s `forget` clears it when the subject actually changes, and
   * `forgetFlicker()` clears it when the caller knows it has.
   *
   * The last counted frame does not go either, and for a related reason (D2). A reset means the run
   * is void, not that the camera delivered something new — so if the very next offer carries the
   * same frame id, it is still the same picture and still not a second look. Clearing it here would
   * give a re-served frame a fresh vote after every abstention, which on the native path is a vote
   * it could cast sixteen times a second.
   */
  reset() {
    this.key = null;
    this.colors = null;
    this.count = 0;
    this.since = 0;
  }
  /**
   * Forget which sticker was flickering — this is a different subject, or a different scan.
   *
   * Called where the caller KNOWS the subject changed and `classify` will not see it: a side was
   * captured (the next side is a new subject with no frame in between to compare), or the scan was
   * restarted. Keeping it across those would name a sticker of the side before last.
   */
  forgetFlicker() {
    this.breaks.clear();
    this.breakColours.clear();
  }
  /**
   * Forget which frame was last counted — the camera itself changed, so its ids mean nothing here.
   *
   * Separate from `reset()` because the two answer different questions: a reset says this RUN is
   * void, and this says the numbering is. A reopened camera or a switched device may restart its
   * counter, and a new frame that happened to reuse the last id would otherwise be discarded as a
   * repeat — silently, and for exactly one frame, which is the kind of fault that is never found.
   */
  forgetFrames() {
    this.lastFrame = null;
  }
};

// view/ai-scan-panel.ts
var RE_READ_LINE = "Show one side to the camera to re-read just that side.";
var COUNT_WORDS = [
  "",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten"
];
var GUIDE = {
  U: { color: "WHITE", swatch: "#f6f7f8" },
  R: { color: "RED", swatch: "#d0202a" },
  F: { color: "GREEN", swatch: "#049e4a" },
  D: { color: "YELLOW", swatch: "#ffd400" },
  L: { color: "ORANGE", swatch: "#ff6a00" },
  B: { color: "BLUE", swatch: "#0057c8" }
};
var CLASS_SWATCH = FACES.map((f) => GUIDE[f].swatch);
var TICK_FLOOR_MS = 60;
var STABLE = 3;
var STABLE_MS = 500;
var TICK_FAIL_MS = 3e3;
var INFERENCE_TIMEOUT_MS = 15e3;
var INFERENCE_TIMEOUT = "InferenceTimeoutError";
var CHECK_BEAT_MS = 350;
function sideClaimed(colors) {
  const centre = colors[4];
  return centre !== void 0 && isColour(centre) ? slotOf(centre) : void 0;
}
function seenIn(output, dets, faceBoxes) {
  const picture = output.frame ?? output.picture;
  if (!picture) return null;
  const stickers = dets.flatMap((d) => {
    const [x, y, w, h] = toFrameBox([d.cx, d.cy, d.w, d.h], picture, IMG_SIZE);
    if (x < 0 || y < 0 || x > picture.width || y > picture.height) return [];
    return {
      x: x / picture.width,
      y: y / picture.height,
      w: w / picture.width,
      h: h / picture.height,
      colour: d.classId,
      confidence: d.confidence,
      // The face's boxes are in corner form (`FaceFit.boxes`), made from these very detections by
      // the same arithmetic, so equality is exact.
      inFace: faceBoxes?.some(
        (b) => b[0] === d.cx - d.w / 2 && b[1] === d.cy - d.h / 2 && b[2] === d.w && b[3] === d.h
      ) ?? false
    };
  });
  return { width: picture.width, height: picture.height, stickers };
}
var LIGHT_CONFUSED = /* @__PURE__ */ new Set(["1,4", "3,4"]);
var OPENING = "Show any side of your cube to the camera.";
var PAINTING = "Painting by hand \u2014 tap any sticker and pick its colour.";
var SLOW_OPEN_MS = 8e3;
var SLOW_OPEN = "The camera has not opened. Allow camera access for this app, then try again.";
var PINNED_GONE = "The camera you chose is unavailable \u2014 using the default one.";
var SLOW_LOAD_MS = 8e3;
var LOAD_TIMEOUT_MS = 6e4;
var CELL_NAMES = [
  "top left",
  "top middle",
  "top right",
  "middle left",
  "centre",
  "middle right",
  "bottom left",
  "bottom middle",
  "bottom right"
];
function cameraRefusalWords(name) {
  switch (name) {
    case "NotAllowedError":
    case "SecurityError":
      return "The camera is blocked for this app. Allow the camera in your browser or system settings, then press Start.";
    case "NotFoundError":
    case "DevicesNotFoundError":
      return "No camera was found. Plug one in or connect one, then press Start. You can also paint the cube by hand.";
    case "NotReadableError":
    case "TrackStartError":
      return "Another app is using the camera. Close it, then press Start.";
    case "OverconstrainedError":
    case "ConstraintNotSatisfiedError":
      return "That camera cannot be used for scanning. Press Start to try the default one instead.";
    default:
      return null;
  }
}
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
var announced = /* @__PURE__ */ new WeakSet();
var AiScanPanel = class _AiScanPanel extends HTMLElement {
  root;
  /** Model URL; the app can override before the element renders. */
  modelUrl = "./vendor/cubedet.onnx";
  /**
   * The frame EPOCH of the tick that is mid-inference, or null when none is.
   *
   * A number rather than a flag, because the flag outlived the thing it was guarding. An inference
   * that never settles left it set for the life of the page: `stop()` and `start()` bump the epoch
   * and rebuild the loop, but the flag survived both, so every tick of the new scan returned at the
   * first line and the scanner could not be recovered by anything short of a reload. Scoped to the
   * epoch, a stale inference blocks only the scan it belongs to — and the `finally` below clears
   * the guard only when it is still the one it set, so an abandoned tick landing late cannot let a
   * second inference into the current epoch.
   */
  busy = null;
  /** `headless`: draw nothing, and let the host draw from 'scan-progress'. */
  headless = false;
  faces = {};
  /** The 9 colour classes in view right now, or null when no clean side is; rides on every report. */
  live = null;
  /** The latest frame's boxes in picture coordinates, for `ScanProgress.seen`. */
  seen = null;
  /** Set just before the report that refuses a side already held, and taken by that report. */
  shownAgain = false;
  /**
   * Moved by everything that changes what a queued capture announcement would be about — `reset()`
   * (the scan thrown away), `stop()` (the camera released: painting, a finished scan, the element
   * leaving the page) and `rescanFace()` (a side taken back) — so an announcement queued before one
   * of them can tell it is stale (see `captured`).
   */
  captureEpoch = 0;
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
   * The scan trace (see scan-trace.ts): off unless `localStorage.cubusScanTrace` is '1', decided
   * once per loop. `tickNote` collects what one tick learned — `readFrame` knows the outcome,
   * `onTick` knows the timing — and is committed once per tick, so a record is never half a tick.
   */
  trace = new ScanTrace();
  /**
   * The centre resolution's thread (D3, `dev-docs/scan-pipeline-audit-2026-09-23.md` §3).
   *
   * One per panel, like the misread decoder and for the same reason: it is a module that parses in
   * about a millisecond and is spawned only by a centre collision, which most scans never reach.
   */
  /**
   * The session recorder (D9/P2, `dev-docs/scan-pipeline-audit-2026-09-23.md` §3 and §4 Stage 0.1).
   *
   * OFF unless `localStorage.cubusScanRecord` is '1', read once per loop exactly as the trace's
   * switch is. The trace could never become a fixture — rounded boxes, capped at sixteen, scores
   * only for the centre probe — so a bug report could not be turned into a replayable case. This
   * keeps what a replay needs, and `__cubusScanRecord.finish({cube, conditions, truth})` hands back
   * a session `parseSession` accepts.
   */
  recorder = new SessionRecorder();
  recording = false;
  tracing = false;
  tickNote = {};
  /** The words last put on screen, which the trace records as what the person scanning saw. */
  lastLine = "";
  /**
   * The camera, its detector, its loop, and the two counters that keep a stale attempt or a
   * stale frame from speaking. It never speaks itself — see CameraSession.
   */
  cam = new CameraSession();
  /** When the current run of failing ticks began, or null when the last tick completed. */
  tickFailingSince = null;
  /**
   * When the current run of frameless ticks began, or null when a frame last arrived.
   *
   * A SECOND clock, because "the tick threw" and "the tick answered, with no frame" are different
   * facts and only one of them was watched. A camera that opens and never delivers answers every
   * tick with `null` — which cleared the failure clock above, on the reasoning that a tick which
   * got an answer at all is a working scanner. It is not: the panel idled on "Show any side" for
   * as long as the screen was open, with a live lens and nothing to say. Both clocks route to the
   * same `tickFail`, whose wording ("the camera opened but no frame could be read") was already
   * describing this case while being unreachable from it.
   */
  noFrameSince = null;
  /** How long the last inference took, so the tick can follow the runtime — see TICK_FLOOR_MS. */
  lastInferenceMs = 0;
  /**
   * Faces whose rotation is KNOWN to be the canonical one — painted in place, or settled by an
   * accepted scan (`finishAccepted` rotates the captures and then says so here).
   *
   * A camera capture is at whatever rotation the user held the side, and nothing about the capture
   * itself says which. Two places need that distinction and both were getting it wrong:
   * hand-painting, which edits stickers by index and therefore cannot edit a face whose index
   * mapping is unknown; and a re-check after a settle, which was searching 4^6 rotations it had
   * already solved and asking for confirmations all over again.
   */
  settled = /* @__PURE__ */ new Set();
  /**
   * What `loop()` was about to say when it found the camera dark, so `start()` can say it once the
   * lens answers. Without this the instruction was simply lost: `rescanFace` says "Show the ORANGE
   * side again", a finished scan has released the camera, and the reopen replaced that sentence
   * with "Opening the camera…" and then the generic idle line — so the one side the scanner was
   * waiting for was never named.
   */
  pendingOpening = null;
  /** Sides handed back by `rescanFace` since the loop last spoke — named together when it does. */
  rescanQueue = [];
  /** Captures known to be in canonical rotation, from answering a `confirm` request. */
  /** Each confirmation with the hold it answered: the assembler projects it into every scheme's
   *  frame from `up`, so a capture without its hold is not a confirmation (ADR 0001). */
  confirmed = {};
  /**
   * How long the scan may look at a cube and capture NOTHING before it says so and offers the way
   * out (`dev-docs/scan-recording-session-2026-09-23.md`).
   *
   * MEASURED, on a recording of the cube this exists for. Over 108 seconds and 1,552 frames the scan
   * made ZERO captures and said "hold still" throughout: the detector found two or three of that
   * face's nine stickers and scattered the rest below the confidence floor, so there was never a
   * face to read. Lowering the floor to 0.05 recovers nothing — the most boxes surviving isolation
   * in the whole stretch is eight, median five.
   *
   * So the honest thing is not another way to arbitrate readings that do not exist; it is to stop
   * spending a person's time. Twelve seconds is several times the 2–4 seconds a side takes when the
   * detector can see it at all, so a slow-but-working scan is never interrupted, and it is far short
   * of the 108 seconds this cube cost.
   *
   * THE BOUND IS ABOUT PROGRESS, NOT ABOUT TIME. It runs from the last capture, so a scan that is
   * getting somewhere — five sides in, one to go — never trips it.
   */
  static STUCK_AFTER_MS = 12e3;
  /**
   * How recently the detector must have seen SOMETHING for a stall to be claimed.
   *
   * A second and a half — several ticks on either runtime, so a frame or two with nothing on it
   * does not retract the claim mid-sentence, and a cube actually put down stops it quickly.
   */
  static SIGHTING_FRESH_MS = 1500;
  /**
   * How long "Reading a side — hold still…" survives a frame the fit refused.
   *
   * MEASURED, 2026-09-24. The screen's sentence was changing every 124 ms at the median, and 81% of
   * the sentences it showed lasted under half a second — unreadable by anyone. The cause was not the
   * words but the RATE: a fit that succeeds and fails on alternate frames made "Reading a side" and
   * "Show any side to the camera." alternate at the tick rate, and those two were 77 of the 134
   * sentences shown across three sessions. They are one situation to the person holding the cube.
   *
   * So a fit is remembered for a moment rather than asked of this frame alone. It is the same idiom
   * `SIGHTING_FRESH_MS` already uses for "an empty frame is not a stall", and it states something
   * true: a side IS being read, across a run the gate itself measures over several frames. Half a
   * second is comfortably longer than the dropouts (one or two frames, 60–130 ms) and far shorter
   * than the time it takes to turn a cube, so putting the cube down still falls back at once.
   *
   * IT CONTINUES A READING CAPTION AND NEVER REVIVES ONE, which is the whole of why it is safe.
   * Unconditionally, it painted "Reading a side" back over whatever the card had just been given —
   * a side filed, the ask for one more look, a finished scan — because those are all followed by a
   * frame that fits nothing while the cube is still in view. Requiring the caption to ALREADY be
   * the reading line makes it hysteresis on one state rather than an override of every other, and
   * it needs no exception for the no-frame path: a withdrawal writes the idle line first, so there
   * is nothing left for the grace to continue.
   */
  static READING_GRACE_MS = 500;
  /** The caption the grace continues. One literal, so the test and the two sites cannot drift. */
  static READING_LINE = "Reading a side \u2014 hold still\u2026";
  /** When a frame last fitted a face — what `READING_GRACE_MS` is measured from. */
  lastFitAt = 0;
  /**
   * When this scan last CAPTURED something, on the monotonic clock — or when the loop began.
   *
   * `performance.now()`, like every other duration here: `Date.now()` follows an NTP correction, and
   * a clock step of twelve seconds would announce a stall that never happened.
   */
  lastProgressAt = 0;
  /**
   * When the detector last produced ANY candidate, on the monotonic clock.
   *
   * The stall claim is "something is in front of the camera and it is not being read". Without this
   * the same sentence fires at an empty room: a person who puts the cube down for twelve seconds
   * would be told their cube cannot be read, which is false and is exactly the kind of unmeasured
   * claim `scan-sentences.test.mjs` exists to refuse.
   */
  lastSightingAt = 0;
  awaiting = null;
  /**
   * The cube's colour scheme as the LAST VERDICT established it — `ScanProgress.scheme`. Null
   * until a verdict speaks; set by an accepted scan and by an accepted painting (whose authored
   * centres ARE its scheme); cleared by `reset()`, because the next cube is a different cube. A
   * refusal never sets it. Corrections keep it: a tap re-decides a sticker, not the cube.
   */
  scheme = null;
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
  /**
   * The notice a CAMERA OR STARTUP FAILURE pinned, so a start that works can take exactly it down.
   *
   * A notice stands until the situation changes, and a working scanner IS the situation changing —
   * but nothing cleared these three ("The camera did not open", "The model did not load", "The
   * scanner stopped"), so a user who pressed Start again and got a live camera and a running scan
   * kept reading that the scanner had stopped. The transient status line said one thing and the
   * pinned sentence the opposite, which is the state this field exists to make impossible.
   *
   * Held BY IDENTITY rather than as a flag: the clear only fires if the notice on screen is still
   * the very object the failure pinned, so a refusal, a confirm request, or any other guidance
   * raised in between is left exactly where it is. Capture guidance is not a camera fault and must
   * survive a restart.
   */
  cameraFault = null;
  /** Where a colour misread most plausibly is; rides on every report so a host can mark them. */
  suspects = [];
  /** The pending deferred assembly (see CHECK_BEAT_MS); epoch-guarded and cleared on stop(). */
  checkTimer = null;
  /** The misread decode, off this thread where the page has one to spare. */
  misread = new MisreadDecoder();
  /**
   * Serial number of the READING a diagnosis is about.
   *
   * Bumped by everything that re-decides the verdict — a capture, a correction, a paint stroke, a
   * mode change, a restart — so an answer that arrives seconds later can be recognised as being
   * about a cube that is no longer on screen. Not the camera's `frameEpoch`: that moves when the
   * camera does, and a tap on a sticker changes the reading without touching the camera at all.
   */
  diagnosisEpoch = 0;
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
    this.cam.park();
    this.dropDiagnosis();
    this.misread.dispose();
  }
  /**
   * Everything decided about the current reading is stale from here on.
   *
   * A diagnosis in flight is about the six faces AS THEY WERE when it was posted, and the decode
   * that produces it can take seconds; bumping the epoch is what stops that answer landing on top
   * of a cube the user has since corrected, re-shown or thrown away. Called from every site that
   * clears `suspects` — those are exactly the moments the verdict is re-opened.
   */
  dropDiagnosis() {
    this.diagnosisEpoch++;
  }
  /**
   * The reading has changed: everything decided ABOUT it is void.
   *
   * One operation, because it always was one and was written out three times — `rescanFace`,
   * `setSticker` and `reset` each carried the same seven lines, and the panel's state is coupled
   * enough that a caller which remembers six of them leaves a real defect: a confirmation that
   * answers a question about a reading that no longer exists, a suspect list pointing at stickers
   * that have moved, a `finished` that keeps the Solve button lit over a cube the panel is about
   * to refuse. Every one of those has been a bug here.
   *
   * What is NOT here is deliberate: the captures themselves, the rotations, and the dots. Which
   * sides survive an invalidation is exactly what distinguishes its three callers — a rescan drops
   * one face, a reset drops all six, a correction drops none — so folding that in would make this
   * a switch on its caller rather than an operation.
   */
  invalidateReading() {
    this.confirmed = {};
    this.awaiting = null;
    this.mismatches = 0;
    this.finished = false;
    this.notice = null;
    this.suspects = [];
    this.dropDiagnosis();
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
    this.captureEpoch += 1;
    if (this.checkTimer !== null) {
      clearTimeout(this.checkTimer);
      this.checkTimer = null;
    }
    this.cam.close();
    this.forgetObservation();
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
    this.still.forgetFrames();
    this.still.forgetFlicker();
    const detector = await this.ensureDetector();
    if (!this.cam.current(gen)) return;
    const slowOpen = setTimeout(() => {
      if (this.cam.current(gen) && this.cam.device === null) {
        this.report("error", this.tinted("err", SLOW_OPEN));
      }
    }, SLOW_OPEN_MS);
    try {
      const facing = this.getAttribute("facing");
      const facingMode = facingOf(facing);
      const pinned = this.getAttribute("device-id") || void 0;
      const { fellBack } = await this.cam.open(detector, { deviceId: pinned, facingMode }, gen);
      if (!this.cam.current(gen)) return;
      this.cam.device = detector.device;
      if (startBtn) startBtn.hidden = true;
      if (!this.cam.modelLoaded) {
        this.report("loading", "Camera ready \u2014 loading the model\u2026");
        await this.loadModel(detector, gen);
        if (!this.cam.current(gen)) return;
        this.cam.modelLoaded = true;
        this.announceRuntime(detector);
      }
      this.clearCameraFault();
      const pending = this.pendingOpening;
      this.pendingOpening = null;
      const phase = pending?.phase ?? (this.awaiting ? "confirm" : "scanning");
      const opening2 = pending?.words ?? (this.awaiting ? this.confirmWords(this.awaiting) : [OPENING]);
      if (fellBack) this.loop(phase, this.tinted("err", PINNED_GONE), " ", ...opening2);
      else this.loop(phase, ...opening2);
    } catch (err) {
      this.startFailed(err, gen, startBtn);
    } finally {
      clearTimeout(slowOpen);
    }
  }
  /**
   * Wait for the model, but not forever, and say so while waiting.
   *
   * The load is a multi-megabyte fetch plus a compile, so several seconds is normal and a minute
   * on a bad connection is not a fault. What was wrong is that there was no upper bound at all: a
   * stalled fetch left "Camera ready — loading the model…" standing for the life of the screen,
   * with the lens on and no control to press, which is the shape of a hung app rather than of a
   * slow one.
   *
   * The timeout ABANDONS THE WAIT, not the load — `Detector.load` is idempotent and now guards its
   * own in-flight promise, so a load that eventually finishes is still there for the next Start
   * rather than being started a second time.
   *
   * EVERY WRITE TO `notice` HERE IS GENERATION-GUARDED (2026-09-05). This attempt's load can settle
   * long after a stop() or a newer start() — a minute later, in the timeout's case — and the notice
   * is the panel's one pinned sentence, so a superseded attempt writing to it replaces whatever the
   * CURRENT state is saying: "the model did not load" over a scanner that is running, or a cleared
   * notice over a camera refusal the user still needs to read. It is the same rule the rest of
   * start() follows, and this method was the one place that did not.
   */
  async loadModel(detector, gen) {
    let waiting = false;
    const slow = setTimeout(() => {
      if (!this.cam.current(gen) || this.cam.modelLoaded) return;
      waiting = true;
      this.notice = {
        title: "The model is taking a while",
        tone: "info",
        body: "The scanner downloads its model once, and this connection is slow. It will start on its own when the download finishes \u2014 or paint the cube by hand instead."
      };
      this.report("loading", "Still loading the model\u2026");
    }, SLOW_LOAD_MS);
    let timer;
    let timedOut = false;
    try {
      await Promise.race([
        detector.load(),
        new Promise((_resolve, reject2) => {
          timer = setTimeout(() => {
            timedOut = true;
            reject2(
              new Error(
                `the model did not load within ${Math.round(LOAD_TIMEOUT_MS / 1e3)} seconds`
              )
            );
          }, LOAD_TIMEOUT_MS);
        })
      ]);
      if (waiting && this.cam.current(gen)) this.notice = null;
    } catch (err) {
      if (!this.cam.current(gen)) throw err;
      if (timedOut) {
        this.cameraFault = {
          title: "The model did not load",
          tone: "err",
          body: "The scanner could not finish downloading its model. Check the connection and press Start to try again \u2014 or paint the cube by hand, which needs no model."
        };
        this.notice = this.cameraFault;
      } else if (waiting) {
        this.notice = null;
      }
      throw err;
    } finally {
      clearTimeout(slow);
      clearTimeout(timer);
    }
  }
  /** Take down the notice a camera/startup failure pinned, if it is still the one showing. */
  clearCameraFault() {
    if (this.cameraFault === null) return;
    if (this.notice === this.cameraFault) this.notice = null;
    this.cameraFault = null;
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
    const raw = String(err?.message ?? err);
    const said = cameraRefusalWords(err?.name);
    if (said) {
      console.warn("[ai-scan-panel] the camera would not open", err);
      this.cameraFault = { title: "The camera did not open", tone: "err", body: said };
      this.notice = this.cameraFault;
      this.report("error", this.tinted("err", said));
      return;
    }
    this.report("error", this.tinted("err", `Cannot start: ${raw}`));
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
  }
  /**
   * Say which runtime won, and what it is running on — once per detector, on the console.
   *
   * TWO defects in one line. It was called only from `useDetector`, the test seam, so the question
   * it exists to answer ("is this build on the fast native path, or has it silently demoted itself
   * to wasm?") had no answer in any production build — the only place it ever printed was a test.
   * And its text carried three stale numbers: "~400 ms/frame" for a wasm run measured at 57 ms,
   * and a per-frame figure for the native path that is a claim about one machine's ANE.
   *
   * So it prints what is actually KNOWN here: the runtime that was chosen, and the provider list
   * the loaded runner was created with. No timings — a number that was true on the machine the
   * comment was written on is worse than no number, because it reads as a measurement of THIS
   * machine. `ModelRunner.providers` documents the one thing the list does not say: which provider
   * executed each node, which onnxruntime exposes no way to ask.
   *
   * Once per DETECTOR, not per panel: the detector is parked and reused across screen visits, so
   * per-panel would print the same line on every visit to the scan screen, and per-page would miss
   * a runner rebuilt on wasm after the GPU was judged too slow.
   */
  announceRuntime(detector) {
    if (announced.has(detector)) return;
    announced.add(detector);
    const providers = detector.providers;
    const on = providers && providers.length > 0 ? ` \u2014 providers: ${providers.join(", ")}` : "";
    const where = this.cam.runtime === "native" ? "native (the cube-vision plugin \u2014 CoreML on Apple, LiteRT on Android)" : `web (the browser runtime${on})`;
    console.info(`[cubus] scanner runtime: ${where}`);
  }
  reset() {
    this.captureEpoch += 1;
    this.forgetObservation();
    this.invalidateReading();
    this.settled.clear();
    this.pendingOpening = null;
    for (const f of FACES) delete this.faces[f];
    this.scheme = null;
    this.buildDots();
  }
  /**
   * (Re)start the capture loop. `opening` replaces the standard prompt, so a message explaining
   * why we are starting over survives instead of being overwritten within one tick.
   */
  loop(phase, ...opening2) {
    this.cam.stopLoop();
    this.forgetObservation();
    this.tickFailingSince = null;
    this.noFrameSince = null;
    const restart = this.maybe("restart");
    if (restart) restart.hidden = false;
    if (this.cam.device === null) {
      if (opening2.length > 0) this.pendingOpening = { phase, words: opening2 };
      void this.start();
      return;
    }
    this.report(phase, ...opening2.length > 0 ? opening2 : [OPENING]);
    this.rescanQueue = [];
    this.tracing = traceEnabled();
    if (this.tracing) {
      this.trace.begin({
        runtime: this.cam.runtime ?? "unknown",
        providers: this.cam.chosen?.providers ?? void 0,
        phase,
        floorMs: STABLE_MS
      });
      globalThis.__cubusScanTrace = this.trace;
    }
    this.lastProgressAt = performance.now();
    this.recording = recordEnabled();
    if (this.recording) {
      this.recorder.begin({
        id: `scan-${(/* @__PURE__ */ new Date()).toISOString()}`,
        // What the scan knows. The cube, the conditions and the TRUTH are a person's to supply at
        // `finish()` — a corpus labelled by the detector measures nothing (§4.1), and one labelled
        // `cube: 'unknown'` is worse than no entry because it looks like a measurement.
        model: {
          hash: this.cam.chosen?.loadedModel ?? "unknown",
          name: this.cam.chosen?.loadedModel ?? "bundled",
          runtime: this.cam.runtime ?? "unknown"
        }
      });
      globalThis.__cubusScanRecord = this.recorder;
    }
    this.cam.beginLoop(
      () => Math.max(TICK_FLOOR_MS, Math.round(this.lastInferenceMs)),
      () => void this.onTick()
    );
  }
  stopLoop() {
    this.cam.stopLoop();
  }
  /**
   * One frame: ask the detector, then hand the answer to whichever of the three outcomes it is.
   *
   * What is left here is the INFERENCE's lifetime — its guard, its deadline, its freshness and the
   * cadence measurement — and nothing about cubes. Three outcomes moved out with the branching
   * they carried (`noFrameTick`, `readFrame`, `failingTick`), which is the same split
   * `fileSettledRead` was made by and for the same reason: whether a frame arrived is a question
   * about the camera, what it shows is a question about the cube.
   */
  async onTick() {
    if (this.cam.device === null || !this.cam.chosen || !this.cam.modelLoaded) return;
    const epoch = this.cam.frameEpoch();
    if (this.busy === epoch) return;
    this.busy = epoch;
    const started = performance.now();
    let deadline;
    try {
      const output = await Promise.race([
        this.cam.chosen.next(),
        new Promise((_resolve, reject2) => {
          deadline = setTimeout(() => {
            const timedOut = new Error(
              `the detector did not answer within ${Math.round(INFERENCE_TIMEOUT_MS / 1e3)} seconds`
            );
            timedOut.name = INFERENCE_TIMEOUT;
            reject2(timedOut);
          }, INFERENCE_TIMEOUT_MS);
        })
      ]);
      if (!this.cam.freshFrame(epoch)) return;
      this.lastInferenceMs = performance.now() - started;
      this.tickNote = {};
      if (output === null) {
        this.commitTick({ outcome: "no-frame" });
        this.tickFailingSince = null;
        this.noFrameTick();
        return;
      }
      this.noFrameSince = null;
      await this.readFrame(output, epoch);
      if (!this.cam.freshFrame(epoch)) return;
      this.commitTick({});
      this.tickFailingSince = null;
    } catch (err) {
      if (!this.cam.freshFrame(epoch)) return;
      this.commitTick({
        outcome: "error",
        error: err instanceof Error ? err.message : String(err),
        inferMs: performance.now() - started
      });
      this.failingTick(err);
    } finally {
      clearTimeout(deadline);
      if (this.busy === epoch) this.busy = null;
    }
  }
  /**
   * The tick answered, with no frame.
   *
   * No frame is not a still cube — it is no observation at all. An abstaining frame already reset
   * the streak; leaving a missing one alone meant identical reads either side of a stall could
   * satisfy both the count and the duration without the cube having been watched in between.
   *
   * And it is not a working scanner either, which is the half that was missing. A camera that opens
   * and never delivers answers `null` on every tick, and `null` clears the failure clock in
   * `onTick` — so the one failure that needs no exception to happen was the one failure nothing
   * watched. Its own clock, same limit, same fail-loud exit.
   */
  noFrameTick() {
    this.withdrawObservation();
    const now = performance.now();
    this.noFrameSince ??= now;
    if (now - this.noFrameSince >= TICK_FAIL_MS) {
      this.tickFail(
        new Error(
          `the camera has been open for ${Math.round(now - this.noFrameSince)} ms without delivering a frame`
        )
      );
    }
  }
  /** A frame arrived: decide whether there is a read worth acting on, and hand it on if so. */
  async readFrame(output, epoch) {
    const began = performance.now();
    const wide = this.recording ? detectionsFromOutput(output, { confThreshold: NEAR_FLOOR_RECORD }) : null;
    const dets = wide ? wide.filter((d) => d.confidence >= MIN_STICKER_CONFIDENCE) : detectionsFromOutput(output);
    if (wide) {
      this.recorder.frame(wide, {
        ...output.frameId === void 0 ? {} : { frameId: output.frameId },
        inferMs: this.lastInferenceMs
      });
    }
    let fit;
    if (this.tracing) {
      const frame2 = traceFrame(output, {}, dets);
      fit = frame2.fit;
      this.note({
        ...frameNote(frame2),
        traceMs: Math.round((performance.now() - began) * 10) / 10
      });
    } else {
      fit = fitFace(dets);
    }
    if (dets.length > 0) this.lastSightingAt = performance.now();
    this.seen = seenIn(output, dets, fit.ok ? fit.face.boxes : void 0);
    if (!fit.ok) {
      this.still.reset();
      this.showPreview(null);
      const reading = this.lastLine === _AiScanPanel.READING_LINE && !this.stuck() && performance.now() - this.lastFitAt < _AiScanPanel.READING_GRACE_MS;
      this.report(
        this.awaiting ? "confirm" : "scanning",
        reading ? _AiScanPanel.READING_LINE : this.idleLine()
      );
      this.note({ outcome: "abstain", reason: fit.reason, geometry: fit.geometry });
      return;
    }
    const settled = this.still.offer(fit.face.colors, performance.now(), output.frameId);
    this.lastFitAt = performance.now();
    this.showPreview(fit.face.colors);
    if (!settled) {
      const flicker = this.still.flickering();
      this.report(
        this.awaiting ? "confirm" : "scanning",
        this.stuck() ? this.stuckLine() : flicker === null ? _AiScanPanel.READING_LINE : this.flickerLine(flicker)
      );
      this.note({ outcome: "reading", ...this.readNote(fit.face), flicker });
      return;
    }
    this.note({ outcome: "settled", ...this.readNote(fit.face) });
    const frame = output.frame ?? await this.framePixels(output, epoch);
    const lab = frame && fit.face.boxes ? stickerLab(frame, fit.face.boxes, IMG_SIZE) ?? void 0 : void 0;
    if (!this.cam.freshFrame(epoch)) return;
    const read = fit.face.ordering === "sorted" ? { ...fit.face, ordering: "sorted" } : fit.face;
    this.fileSettledRead(lab ? { ...read, lab } : read);
  }
  /**
   * The pixels of the frame a fit was made on, from a detector that did not ship them (D7).
   *
   * Null whenever it cannot be had — no `framePixels` on this runtime, no frame identity to ask by,
   * or a plugin that no longer holds that frame — and null on a failure, loudly on the console but
   * not into the scan: the paint path is the assembly's LAST resort before refusing, so losing it
   * costs a recovery that did not exist here at all until today, while letting the error through
   * would turn a working scan into a failed tick.
   *
   * BY ID, never "the latest": the grid was fitted to one particular picture, and pixels from a
   * later frame would place every sticker box over paint that has since moved.
   */
  async framePixels(output, epoch) {
    const detector = this.cam.chosen;
    if (!detector?.framePixels || output.frameId === void 0) return null;
    try {
      const frame = await detector.framePixels(output.frameId);
      return this.cam.freshFrame(epoch) ? frame : null;
    } catch (cause) {
      console.warn("[ai-scan-panel] the frame behind a settled read could not be read", cause);
      return null;
    }
  }
  /** Record a decision that is not a frame, for the trace. A no-op with the trace off. */
  traceEvent(kind, detail) {
    if (this.tracing) this.trace.event(kind, detail);
    if (this.recording) this.recorder.decision(kind, detail);
  }
  /** Add to what this tick has learned, for the trace. A no-op with the trace off. */
  note(fields) {
    if (this.tracing) Object.assign(this.tickNote, fields);
  }
  /** A read's colours and confidences, and where the stillness run stands after it. */
  readNote(face) {
    const { run, heldMs } = this.still.status();
    return {
      colors: [...face.colors],
      conf: face.confidence.map((c) => Math.round(c * 1e3) / 1e3),
      run,
      heldMs: Math.round(heldMs)
    };
  }
  /**
   * File this tick with the trace, then start the next one clean. A no-op with the trace off.
   *
   * A tick that reaches here without an outcome is recorded as an ERROR that says so, not given a
   * plausible one: every path through `readFrame` names its outcome, and a path that stops doing so
   * is a bug in this wiring that the trace should show rather than paper over.
   */
  commitTick(extra) {
    if (!this.tracing) return;
    const note = { ...this.tickNote, ...extra };
    this.tickNote = {};
    this.trace.record({
      ...note,
      outcome: note.outcome ?? "error",
      ...note.outcome === void 0 ? { error: "the tick ended without telling the trace how" } : {},
      inferMs: Math.round((note.inferMs ?? this.lastInferenceMs) * 10) / 10,
      line: this.lastLine
    });
  }
  /**
   * The tick failed: transient at first, an error if it persists.
   *
   * The distinction is duration, not type: the camera-not-ready case clears in a tick or two, and
   * nothing else does. `performance.now()`, because this is a claim about ELAPSED time — see
   * TICK_FAIL_MS.
   *
   * A FAILED FRAME BREAKS THE STILLNESS RUN, and that was missing. Every other way a tick can end
   * without a usable read resets it — a frameless tick, an abstain, a bad geometry — but a frame
   * that THREW left the run standing, so two matching reads, a failure, and a third matching read
   * half a second later satisfied both halves of the capture gate over an observation that had a
   * hole in it. Stillness is a claim about what was watched continuously; a frame nobody could read
   * is not a frame that showed the cube unmoved.
   */
  failingTick(err) {
    this.withdrawObservation();
    const now = performance.now();
    this.tickFailingSince ??= now;
    if (now - this.tickFailingSince >= TICK_FAIL_MS) {
      this.tickFail(err);
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
    this.forgetObservation();
    this.tickFailingSince = null;
    this.noFrameSince = null;
    if (err instanceof Error && (err.name === INFERENCE_TIMEOUT || err.name === INFERENCE_WORKER_LOST)) {
      this.cam.chosen?.dispose?.();
      this.cam.modelLoaded = false;
    }
    this.dropDiagnosis();
    const start = this.maybe("start");
    if (start) {
      start.hidden = false;
      start.disabled = false;
    }
    this.cameraFault = {
      title: "The scanner stopped",
      tone: "err",
      body: "The camera opened but no frame could be read for several seconds. Try Start again, and if it keeps happening the model or the camera driver is at fault rather than the cube."
    };
    this.notice = this.cameraFault;
    this.report("error", "Could not read from the camera.");
    console.error("[ai-scan-panel] scan loop stopped after repeated failures", err);
  }
  /**
   * A read has settled: decide what it MEANS — a new side, one already in hand, the side a confirm
   * asked for, or a correction — and file it.
   *
   * A side is NAMED by its centre's colour and RECOGNISED by that colour together with the eight
   * stickers around it (`sameSide`, which forgives one flickering sticker — a side re-shown with one
   * sticker read differently is the same side, not a stranger with a familiar centre).
   * The centre cannot be left out of recognising a side, because different sides can share their eight
   * exactly: after U D R L F B the white and yellow sides are the same eight stickers around different
   * centres.
   *
   * The run that produced this read was identical in all nine positions (`Stillness`), so its centre
   * is the centre every frame of it showed — there is no such thing here as a side whose centre the
   * scan could not read, because such a side never settles.
   */
  fileSettledRead(read) {
    const claim = sideClaimed(read.colors);
    if (this.awaiting) {
      this.acceptConfirmation(read, claim);
      return;
    }
    if (claim === void 0) {
      this.report(
        "scanning",
        this.tinted("err", "Couldn't read this side's centre \u2014 keep showing it.")
      );
      return;
    }
    if (this.finished) {
      this.report(
        "scanning",
        "This cube is already scanned \u2014 tap a sticker to fix one, or start the scan over for a different cube."
      );
      this.still.reset();
      return;
    }
    if (this.sidesHeld() >= FACES.length) {
      this.replaceCapturedSide(read, claim);
      return;
    }
    const inHand = this.sideInHand(read);
    if (inHand) {
      this.traceEvent("turned-away", {
        face: inHand.slot,
        colors: [...read.colors],
        why: "the same side again"
      });
      const named = this.missingSides();
      this.shownAgain = true;
      this.report(
        "scanning",
        "Already have the ",
        this.bold(GUIDE[inHand.slot].color),
        " side",
        named ? ` \u2014 still need ${named}.` : " \u2014 show a different one."
      );
      this.still.reset();
      return;
    }
    this.fileNewSide(read, claim);
  }
  /**
   * File a read the scan has decided is a side it does not have — under the colour its centre
   * claims, or not at all.
   *
   * The tail of `fileSettledRead`, lifted out (2026-09-21). `kind` is what the capture is announced
   * as — `'side'`, or `'reread'` for a side that was already in hand.
   */
  fileNewSide(read, claim, kind = "side") {
    if (claim === void 0) {
      this.report(
        "scanning",
        this.tinted("err", "Couldn't read this side's centre \u2014 keep showing it.")
      );
      return;
    }
    const holder = this.faces[claim];
    if (holder) {
      this.report(
        "scanning",
        "Two sides are reading as the ",
        this.bold(GUIDE[claim].color),
        " side \u2014 show them again, or tap a sticker to fix one."
      );
      return;
    }
    this.traceEvent("captured", { face: claim, colors: [...read.colors] });
    this.lastProgressAt = performance.now();
    this.capture(claim, read, kind);
  }
  /**
   * A side shown again once all six are in: a CORRECTION, since the loop only runs then because the
   * scan was refused.
   *
   * Which side it corrects is the side its eight point to when they point to one alone, and
   * otherwise the one its centre names — a correction is the moment a sticker has changed, so the
   * eight may no longer agree. Lifted out of `fileSettledRead` (audit, 2026-09-20).
   */
  replaceCapturedSide(read, claim) {
    const byEight = this.sideByEight(read);
    const slot = byEight ?? (claim !== void 0 && this.faces[claim] ? claim : void 0);
    if (slot === void 0) {
      this.report("scanning", "Keep showing that side \u2014 its middle sticker keeps changing colour.");
      return;
    }
    const fresh = withCentre(read, colourOfSlot(slot));
    if (fresh.colors.join(",") === this.faces[slot].colors.join(",")) {
      this.shownAgain = true;
      this.report(
        "scanning",
        "The ",
        this.bold(GUIDE[slot].color),
        " side reads the same as before \u2014 tap a sticker to fix it, or show another side."
      );
      return;
    }
    this.faces[slot] = fresh;
    this.settled.delete(slot);
    this.confirmed = {};
    this.mismatches = 0;
    this.buildDots();
    this.captured("reread", slot);
    this.scheduleCheck(this.tinted("ok", `Re-read the ${GUIDE[slot].color} side \u2014 checking\u2026`));
    return;
  }
  /**
   * A read offered while a confirm is standing: take it as that side, or ask again.
   *
   * Lifted out of `fileSettledRead` (audit, 2026-09-20), which owned eight decisions at once. This
   * is the first of them and the most self-contained: it is the only branch that ends a confirm, and
   * nothing after it in the original ran when a confirm was standing.
   */
  acceptConfirmation(read, claim) {
    const asking = this.awaiting;
    if (!asking) return;
    const asked = asking.face;
    const held = this.faces[asked];
    if (claim !== asked && (held === void 0 || this.sideByEight(read) !== asked)) {
      this.report("confirm", ...this.confirmWords(asking));
      this.still.reset();
      return;
    }
    const looks = this.confirmed[asked] ?? [];
    looks.push({ capture: withCentre(read, colourOfSlot(asked)), up: asking.up });
    this.confirmed[asked] = looks;
    this.awaiting = null;
    this.captured("confirm", asked);
    this.scheduleCheck(this.tinted("ok", "Got it \u2014 checking\u2026"));
  }
  /**
   * The side in hand that `read` shows again, with its slot — or null for a side not in hand: its
   * centre claims the same colour and its eight agree (`sameSide`).
   *
   * BOTH HALVES ARE LOAD-BEARING. The centre alone is not enough, because a side re-shown after one
   * sticker was read differently is the same side; the eight alone are not enough either, because
   * different sides can share them exactly — after U D R L F B the white and yellow sides are the
   * same eight around different centres.
   *
   * A READ WHOSE CENTRE NAMES A SIDE IN HAND IS THAT SIDE UNLESS ITS EIGHT CONTRADICT IT: five of
   * eight agreeing under some turn (`SAME_SIDE_BY_CENTRE`), not seven. Two stickers read differently
   * on a re-show is ordinary; two sides of one cube sharing a centre colour AND five of eight is not
   * (`dev-docs/scanner-audit-2026-09-20.md` §1.7).
   */
  sideInHand(read) {
    const centre = read.colors[4];
    for (const slot of FACES) {
      const side = this.faces[slot];
      if (side && side.colors[4] === centre && sameSide(read.colors, side.colors, SAME_SIDE_BY_CENTRE)) {
        return { side, slot };
      }
    }
    return null;
  }
  /**
   * The named side whose eight `read` shows, when exactly one does — however its centre read. For the
   * moments after six, when every side is named and the one being shown is a side the scan has: a
   * centre that read yellow as white is still that side. When two sides share their eight (a
   * symmetric cube), the eight point to neither and the centre decides, as it always did.
   */
  sideByEight(read) {
    const matches = FACES.filter((f) => {
      const side = this.faces[f];
      return side !== void 0 && sameSide(read.colors, side.colors);
    });
    return matches.length === 1 ? matches[0] : void 0;
  }
  /** File a freshly-recognised face under its own letter, then keep scanning (or finish at six). */
  capture(face, read, kind = "side") {
    this.faces[face] = read;
    this.settled.delete(face);
    this.buildDots();
    this.captured(kind, face);
    const done = this.sidesHeld();
    if (done >= FACES.length) {
      this.scheduleCheck(this.tinted("ok", "All six sides captured \u2014 checking\u2026"));
      return;
    }
    const named = this.missingSides();
    this.report(
      "scanning",
      "Got the ",
      this.bold(GUIDE[face].color),
      ` side \u2014 ${done}/6. ${named ? `Still to show: ${named}.` : "Show another side\u2026"}`
    );
  }
  /**
   * Stop the loop, report 'checking', and run the assembly one beat later (CHECK_BEAT_MS), so the
   * capture or correction that triggered the check paints before any verdict replaces it. Clears
   * the pinned notice: whatever it explained is being re-decided right now.
   *
   * GUARDED ON THE READING, NOT ON THE CAMERA (2026-09-05). A check is a computation over the six
   * faces; the camera has already said everything it is going to say about them. Guarding it with
   * `frameEpoch` meant anything that touched the camera during the 350 ms beat cancelled the
   * verdict and put NOTHING in its place — and switching cameras is exactly that: six captures on
   * screen, `complete` never set, and no way back, because re-showing a side that reads the same
   * as the one on file is answered with "that side reads the same as before". Measured: six
   * captures, no check, and identical re-reads unable to recover it.
   *
   * `diagnosisEpoch` is the serial number of the READING, bumped by everything that re-decides it
   * — a capture, a correction, a paint stroke, a mode change, `reset()` — so a restart during the
   * beat still cancels the check, and `stop()` clears the timer outright for a navigation. What is
   * left running is the case that should always have run.
   */
  scheduleCheck(...opening2) {
    this.stopLoop();
    this.forgetObservation();
    this.finished = false;
    this.notice = null;
    this.suspects = [];
    this.dropDiagnosis();
    this.report("checking", ...opening2);
    const epoch = this.diagnosisEpoch;
    if (this.checkTimer !== null) clearTimeout(this.checkTimer);
    this.checkTimer = setTimeout(() => {
      this.checkTimer = null;
      if (epoch === this.diagnosisEpoch) this.assemble();
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
  /** Sides in hand. Counted by the same test `capturedFaces` files by, without copying a side. */
  sidesHeld() {
    let held = 0;
    for (const face of FACES) if (this.faces[face]) held += 1;
    return held;
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
        colors: Array(9).fill(colourOfSlot(face)),
        confidence: Array(9).fill(1)
      };
      this.faces[face] = read;
      this.settled.add(face);
      this.buildDots();
    } else if (read.colors[index] === colour) {
      return;
    }
    read.colors[index] = colour;
    read.confidence[index] = 1;
    read.locked ??= Array(9).fill(false);
    read.locked[index] = true;
    const row = read.scores?.[index];
    if (read.scores && row) read.scores[index] = row.map((_, c) => c === colour ? 1 : 0);
    this.invalidateReading();
    const done = this.capturedFaces().length;
    if (this.painting) {
      this.afterPaintStroke(
        `Painted the ${GUIDE[face].color} side \u2014 ${done}/${FACES.length} sides.`,
        done
      );
      return;
    }
    if (this.sidesHeld() < FACES.length) {
      this.report("scanning", `Corrected the ${GUIDE[face].color} side. Show another side\u2026`);
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
  afterPaintStroke(line, done) {
    if (done === FACES.length) {
      const result = this.fromPositions(
        assemblePainted(this.positionFaces(), void 0, { diagnose: false })
      );
      if (result.valid) {
        this.finish(result, "painted");
        return;
      }
      this.diagnose(result, (r, first) => {
        this.publishPaintRefusal(r);
        if (!first) this.report("painting", line);
      });
    }
    this.report("painting", line);
  }
  /** A refused painting, said out loud. Called again for each diagnosis that lands for it. */
  publishPaintRefusal(result) {
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
    this.dropDiagnosis();
    if (on) {
      const dropped = this.dropUnsettledCaptures();
      this.stop();
      if (dropped.length > 0) {
        this.notice = {
          title: "Those sides need painting too",
          tone: "info",
          body: "The camera cannot see which way up a side was held, so a side it had not finished checking cannot be edited sticker by sticker. %1 was cleared \u2014 paint it the way it sits on your cube.",
          params: [dropped.map((f) => GUIDE[f].color).join(", ")]
        };
      }
      this.report("painting", PAINTING);
      return;
    }
    void this.start();
  }
  /**
   * Declare which colour a PAINTED cube has under white — the paint board's centre swap.
   *
   * A painting is authored by position, so its centres ARE its scheme: the Down tile's centre is
   * yellow on a Western painting and blue on a Japanese one, and swapping the pair is the one
   * thing a painter can say about it that the tiles cannot. Everything painted stays with its
   * COLOUR — the stickers painted around the blue centre are still around the blue centre, which
   * has simply moved from the back to the bottom — and the reading is re-decided from there,
   * because a cube is legal or not under the arrangement it actually has. Only meaningful while
   * painting: a camera reading's scheme is the scan's to decide, never a caller's (ADR 0001).
   */
  setPaintScheme(scheme) {
    if (!this.painting || !SCHEMES.includes(scheme) || this.scheme === scheme) return;
    this.scheme = scheme;
    this.invalidateReading();
    const under = GUIDE[slotOf(colourOf("D", scheme))].color;
    const line = `Centres swapped \u2014 ${under} is under WHITE now.`;
    const done = this.capturedFaces().length;
    if (done === FACES.length) {
      this.afterPaintStroke(line, done);
      return;
    }
    this.report("painting", `${line} ${PAINTING}`);
  }
  /**
   * Entering painting: forget every capture whose rotation is still unknown, and say which.
   *
   * THE MODE BOUNDARY, stated rather than implied. Painting edits stickers BY INDEX, and
   * `finishAccepted` already spells out why that needs a settled rotation: "a click on sticker i
   * must mean index i of what is stored — without this, correcting a side captured 90° off edited
   * the wrong sticker and turned a good scan invalid." An unsettled camera capture is exactly that
   * side. Carrying it into painting broke two things at once: the tiles a user taps did not match
   * the cube in their hand, and `assemblePainted` — which searches no rotations, by design —
   * judged a 90°-off capture as authored-in-place and reported an INVENTED count. Measured: a
   * correct cube with one side captured a quarter turn off came back as "At least 5 stickers were
   * misread", about a cube with nothing wrong with it.
   *
   * Only the UNSETTLED ones go. A finished scan settles all six into canonical rotation, so the
   * common path — scan, then hand-fix one sticker — loses nothing at all.
   */
  dropUnsettledCaptures() {
    const dropped = FACES.filter((f) => this.faces[f] && !this.settled.has(f));
    if (dropped.length === 0) return dropped;
    for (const f of dropped) this.forgetCapture(this.faces[f]);
    this.confirmed = {};
    this.awaiting = null;
    this.mismatches = 0;
    this.finished = false;
    this.buildDots();
    return dropped;
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
    const held = this.faces[face];
    if (!held) return;
    this.captureEpoch += 1;
    this.forgetCapture(held);
    this.invalidateReading();
    this.buildDots();
    if (!this.rescanQueue.includes(face)) this.rescanQueue.push(face);
    const names = this.rescanQueue.map((f) => GUIDE[f].color);
    const which = names.length === 1 ? `the ${names[0]} side` : `the ${names.slice(0, -1).join(", ")} and ${names[names.length - 1]} sides`;
    this.loop(
      "scanning",
      `Show ${which} again \u2014 ${names.length === 1 ? "it" : "they"} will be read fresh.`
    );
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
  /** Where the read under way stands, for `ScanProgress.settling`. */
  settling() {
    const { run, heldMs } = this.still.status();
    return run === 0 ? null : { run, needed: STABLE, heldMs: Math.round(heldMs), neededMs: STABLE_MS };
  }
  /**
   * One accepted capture: the stage's pulse, and the `scan-capture` event a headless host hears.
   *
   * The event goes out once the capture path has FINISHED — its report written, its check
   * scheduled — as a snapshot taken now. Dispatched in the middle of that path, a listener that
   * restarted the scan, stopped it or switched to painting had its change overwritten when the path
   * carried on over the state it had just cleared (audit, 2026-09-19). And it is not sent at all
   * if the scan changed under it in between — a listener to the path's own report can restart the
   * scan, stop it, switch to painting or take a side back, and "a side was saved" over any of those
   * is a chime and a "got it" for a moment that is gone (audit, 2026-09-19, round 3).
   */
  captured(kind, face) {
    this.still.reset();
    this.still.forgetFlicker();
    this.flash();
    const detail = { kind, face, sides: this.sidesHeld() };
    const epoch = this.captureEpoch;
    queueMicrotask(() => {
      if (epoch === this.captureEpoch) {
        this.dispatchEvent(new CustomEvent("scan-capture", { detail }));
      }
    });
  }
  /**
   * Forget what the camera last showed: the read under way, the live face, and the boxes. ONE place,
   * because it was written out by hand at every site that stops watching, and when `seen` was added
   * it reached some of them — `stop()` then reported a painting with the last frame's boxes still in
   * it, and a check with a finished read's progress (found by audit, 2026-09-19).
   */
  forgetObservation() {
    this.still.reset();
    this.showPreview(null);
    this.seen = null;
  }
  /**
   * A tick that showed nothing — no frame, or an inference that failed: forget the observation, and
   * if something was on show (boxes, a live face, a read under way) say so with one report carrying
   * the waiting line. A headless host otherwise kept drawing the last frame until a later report or
   * the fatal limit; and republishing the last line kept "Reading a side" standing over nothing
   * (audit, 2026-09-19). A tick over nothing says nothing, as before.
   */
  withdrawObservation() {
    const showing = this.seen !== null || this.live !== null || this.still.status().run > 0;
    this.forgetObservation();
    if (showing) this.report(this.awaiting ? "confirm" : "scanning", this.idleLine());
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
   * What an ambiguous scan IS, said before the look that settles it.
   *
   * The sentence this replaced — "Several readings of this cube fit what the camera saw, and six
   * photos cannot tell them apart" — was read as a failed scan by a user whose every colour was
   * correct (2026-09-06). It said neither that the colours were right nor what was undetermined,
   * and the cube drawn beside it looked right because it IS the six sides as they were held. So
   * this says all of it: the colours are read; how many cubes fit them; which sides could have
   * been held more than one way up (the assembler names them); and that the picture shows the
   * sides as held, not which reading is the cube. The ask follows as its own sentence.
   */
  ambiguitySentence(result) {
    const n = result.readings ?? 0;
    const count2 = n >= 2 ? COUNT_WORDS[n] ?? String(n) : "";
    const ways = count2 ? `${count2} ways` : "more than one way";
    const sides = (result.undetermined ?? []).map((f) => GUIDE[f].color);
    const held = sides.length === 0 ? "" : sides.length === 1 ? ` \u2014 the ${sides[0]} side could have been held more than one way up \u2014` : ` \u2014 the ${sides.slice(0, -1).join(", ")} and ${sides[sides.length - 1]} sides could each have been held more than one way up \u2014`;
    return `Every side's colours are read. This cube fits them ${ways}${held} and the picture shows the sides as they were held, not which of the ${count2 || "readings"} it is.`;
  }
  /**
   * What to say about a sticker that keeps breaking the read on its own: WHICH sticker, and — when it
   * has only ever shown two colours — which two. That much is measured. The light remark is added only
   * for a pair the light is known to confuse, because that is the only cause with evidence behind it:
   * red against orange is ambiguous under warm light (`dev-docs/red-orange-fine-tune.md`), and orange
   * read as yellow followed the light, not the pipeline or the sticker size (AGENTS.md, 0.6.1). It
   * says "helps", never "will settle it": the capture rule promises nothing about the next read.
   */
  flickerLine(position) {
    const cell = CELL_NAMES[position] ?? "marked";
    const pair = this.still.flickerColours(position);
    if (pair.length !== 2) return `Reading a side \u2014 the ${cell} sticker keeps changing colour.`;
    const [a, b] = pair.map((c) => GUIDE[FACES[c]].color);
    const light = LIGHT_CONFUSED.has(pair.join(",")) ? " Whiter light on it helps tell them apart." : "";
    return `Reading a side \u2014 the ${cell} sticker keeps changing between ${a} and ${b}.${light}`;
  }
  /**
   * The waiting-for-input line, matched to where the scan actually is. One generic "show any
   * side" for every state was how a finished scan kept being nagged for sides, and how the ask
   * for one SPECIFIC side got contradicted the moment the cube left the frame.
   */
  /**
   * Whether this scan has been looking at a cube and capturing nothing for longer than the bound.
   *
   * False while a confirm is pending or the scan is finished: neither is a stall, and interrupting
   * a confirm with "this side is not being read" would be about the wrong side entirely.
   */
  stuck(now = performance.now()) {
    if (this.awaiting || this.finished) return false;
    if (now - this.lastSightingAt > _AiScanPanel.SIGHTING_FRESH_MS) return false;
    return now - this.lastProgressAt >= _AiScanPanel.STUCK_AFTER_MS;
  }
  /**
   * What to say when nothing has been captured for the bound.
   *
   * IT NAMES ONLY WHAT WAS MEASURED, which is that this scan has read no side — not a tilt, not a
   * shake, not the light, none of which anything here observes (`apps/web/test/scan-sentences.test.mjs`
   * refuses those words by name). And it offers the one thing that always works, because on the cube
   * this was written for the detector finds two or three of nine stickers and no threshold recovers
   * the rest: the person can set the colours themselves.
   */
  stuckLine() {
    const painted = this.capturedFaces().length;
    return painted === 0 ? "This cube isn't being read. You can paint it by hand instead." : "This side isn't being read. Show another side, or paint this one by hand.";
  }
  idleLine() {
    if (this.stuck()) return this.stuckLine();
    if (this.awaiting) {
      return `Looking for the ${GUIDE[this.awaiting.face].color} side \u2014 hold it with ${GUIDE[this.awaiting.up].color} up.`;
    }
    if (this.finished) return "Scan finished \u2014 start the scan over to read a different cube.";
    if (this.capturedFaces().length >= FACES.length) return RE_READ_LINE;
    return "Show any side to the camera.";
  }
  /** "YELLOW and BLUE" — the sides still to show, named once there are few enough to name. */
  missingSides() {
    const missing = FACES.filter((f) => !this.faces[f]);
    if (missing.length === 0 || missing.length > 2) return null;
    return missing.map((f) => GUIDE[f].color).join(" and ");
  }
  /**
   * The scheme the HOST assumes, from the `scheme` attribute — its Cube colours setting. Western
   * when unset or unreadable: the default every cube had before there was a setting, and the
   * assumption the model's class order encodes. Read on demand rather than observed, because it
   * matters only at the moments a position is needed and nothing is drawn from it in between.
   */
  hostScheme() {
    const attr = this.getAttribute("scheme");
    return SCHEMES.find((s) => s === attr) ?? "western";
  }
  /**
   * The scheme positions are taken under when this panel has to lay its slots out as positions:
   * the verdict's, when a verdict decided one, else the host's assumption. Two places need a
   * position at all — a painted cube, whose centres are authored by position, and a settled scan
   * re-checked in place — and both are cubes the scan has already placed or the host has already
   * assumed; nothing else in the panel ever names a position.
   */
  workingScheme() {
    return this.scheme === "western" || this.scheme === "japanese" ? this.scheme : this.hostScheme();
  }
  /** The captures by POSITION under the working scheme — the record `assemblePainted` and an
   *  in-place decode read, whose keys mean where a side sits rather than what colour it is. */
  positionFaces() {
    const scheme = this.workingScheme();
    const out = {};
    for (const slot of FACES) {
      const read = this.faces[slot];
      if (read) out[positionOf(colourOfSlot(slot), scheme)] = read;
    }
    return out;
  }
  /** The tile the host names for a position, as the SLOT its capture lives in. */
  slotAt(position) {
    return slotOf(colourOf(position, this.workingScheme()));
  }
  /**
   * A result that was computed over POSITIONS (the painted path, an in-place decode), with every
   * coordinate it names moved back into slots — the only coordinates a host ever receives.
   */
  fromPositions(r) {
    return {
      ...r,
      ...r.suspects ? { suspects: r.suspects.map((s) => ({ ...s, face: this.slotAt(s.face) })) } : {},
      ...r.misreadFace ? { misreadFace: this.slotAt(r.misreadFace) } : {}
    };
  }
  /**
   * The reading's rotations are already known — painted in place, or settled by an accepted scan.
   *
   * Read in ONE place because two things now depend on it and they must not disagree: which
   * validator runs (`assemblePainted`, no rotation search), and how the deferred misread decode is
   * asked the same question. A decode allowed to rotate a face back reports "0 misreads" about a
   * cube the validator has just refused — measured on nine scrambles with one side turned 90°.
   */
  inPlace() {
    return this.capturedFaces().length === FACES.length && FACES.every((f) => this.settled.has(f));
  }
  /** Read the six faces (plus any confirmations) into a cube, and act on what comes back. */
  assemble() {
    if (this.inPlace()) {
      const { scheme: _assumed, ...checked } = this.fromPositions(
        assemblePainted(this.positionFaces(), void 0, { diagnose: false })
      );
      this.finish(checked, "correction");
      return;
    }
    this.assembleNamed();
  }
  /**
   * The assembly for a scan whose six sides are all named — the tail of `assemble`, lifted out when
   * the centre resolution moved off the page's thread (D3). Unchanged but for its name.
   *
   * A `reread` means a confirmation disagreed with its first capture about colours: adopt the
   * fresh, deliberately-held look as that side's reading and check again. Each adoption pins its
   * side at distance 0, so this settles within six rounds; the cap is a backstop, not a path.
   */
  assembleNamed() {
    let result;
    for (let round = 0; ; round++) {
      try {
        result = assembleColors(this.faces, void 0, this.confirmed, { diagnose: false });
      } catch (err) {
        this.checkFailed(err);
        return;
      }
      const face = result.reread;
      const looks = face === void 0 ? void 0 : this.confirmed[face];
      const named = looks?.[result.rereadLook ?? (looks?.length ?? 0) - 1];
      const fresh = named?.capture;
      if (face === void 0 || named === void 0 || fresh === void 0 || round >= FACES.length) {
        this.finish(result, "camera");
        return;
      }
      this.faces[face] = fresh;
      this.confirmed[face] = looks.filter(
        (look) => look === named || matchingRotations(fresh, look.capture).size > 0
      );
    }
  }
  /**
   * Let go of one capture and of the settle recorded for it.
   *
   * Several removal paths each wrote a subset of this by hand, and a capture nothing held any more
   * went on being counted until the scan was restarted (2026-09-21).
   */
  forgetCapture(capture) {
    for (const f of FACES) {
      if (this.faces[f] === capture) {
        delete this.faces[f];
        this.settled.delete(f);
      }
    }
  }
  /**
   * A check threw. Six well-formed faces should never throw — but if they do, never freeze on
   * "checking…" and never destroy the captures over it: say so and keep scanning. Shared by both
   * ways a check runs, so the two cannot come to say different things about the same failure.
   */
  checkFailed(err) {
    const why = String(err?.message ?? err);
    this.notice = {
      title: "Something went wrong",
      tone: "err",
      body: `Couldn't check the scan (${why}). Show a side again to retry, or start the scan over.`
    };
    this.loop("scanning", this.tinted("err", "Couldn\u2019t check the scan \u2014 see the note."));
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
    if (result.misreadCount === null) {
      return {
        title: "Not a solvable cube",
        tone: "err",
        body: "Working out how many stickers are wrong \u2014 that takes a moment on a badly-read cube."
      };
    }
    if (this.suspects.length > 0) {
      return {
        title: "Check the marked sticker",
        tone: "err",
        body: `Changing it would make this a solvable cube. Check it against your cube first \u2014 when more than one sticker is misread, the marked one can be a sticker that was read correctly. ${recovery.one}`
      };
    }
    if (misread > 1) {
      return {
        title: "Some stickers were misread",
        tone: "err",
        body: `${recovery.lead ?? "At least %1 stickers were misread, so there is no single sticker to point at."} ${recovery.many}`,
        params: [misread, ...recovery.params ?? []],
        ...recovery.action ? { action: recovery.action } : {}
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
  finish(result, origin) {
    this.stopLoop();
    this.forgetObservation();
    this.suspects = result.suspects ?? [];
    if (result.valid) {
      if ((result.lowConfidence?.length ?? 0) === 0) {
        this.finishAccepted(result, origin);
        return;
      }
      this.finishUnsure();
      return;
    }
    if (result.confirm && result.reread === void 0) {
      this.finishConfirming(result, result.confirm);
      return;
    }
    this.finishRefused(result);
  }
  /** Solvable but too faint to trust: no public verdict, a pinned explanation, keep scanning. */
  finishUnsure() {
    this.notice = {
      title: "Some stickers were unclear",
      tone: "err",
      body: "The cube reads as solvable, but some stickers were too faint to trust. Show those sides again, or tap stickers to confirm them."
    };
    this.loop("scanning", this.tinted("err", "Some stickers were too faint to trust."));
  }
  /** Accepted: settle the captures into canonical rotation, release the camera, announce it. */
  finishAccepted(result, origin) {
    const accepted = result.captures;
    if (accepted) {
      for (const f of FACES) {
        const next = accepted[f];
        if (next) this.faces[f] = next;
      }
    }
    const rots = result.rotations;
    if (rots) {
      FACES.forEach((f, fi) => {
        const read = this.faces[f];
        const k = rots[fi] ?? 0;
        if (read && k !== 0) {
          this.faces[f] = {
            ...read,
            colors: rotateFace(read.colors, k),
            confidence: rotateFace(read.confidence, k),
            ...read.scores ? { scores: rotateFace(read.scores, k) } : {},
            ...read.lab ? { lab: rotateFace(read.lab, k) } : {},
            ...read.locked ? { locked: rotateFace(read.locked, k) } : {}
          };
        }
      });
    }
    this.confirmed = {};
    this.awaiting = null;
    this.mismatches = 0;
    this.finished = true;
    for (const f of FACES) this.settled.add(f);
    if (result.scheme !== void 0) this.scheme = result.scheme;
    this.notice = null;
    this.stop();
    this.report("done", this.tinted("ok", "Scan complete \u2014 solvable cube captured."));
    const { captures: _kept, ...detail } = result;
    this.dispatchEvent(
      new CustomEvent("scan-complete", { detail: { ...detail, origin } })
    );
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
      body: (result.ambiguous ? `${this.ambiguitySentence(result)} ` : "A single look could have been held wrong, so another one checks it. ") + this.confirmSentence(confirm)
    };
    this.loop("confirm", ...this.confirmWords(confirm));
  }
  /**
   * Explain a refusal now, and explain it better when the misread count arrives.
   *
   * `publish` is called at least once, synchronously, with `first` true — so the refusal is on
   * screen within the same tick however long the decode turns out to take. It is called a second
   * time, with `first` false, only for the answer to THIS reading: the epoch is captured here and
   * re-read when the answer lands, so a correction, a re-shown side or a restart in between drops
   * the answer rather than describing a cube that is no longer there.
   *
   * Where the page has no worker the whole thing collapses back to one call carrying the count —
   * the behaviour that shipped before the decode moved off this thread.
   *
   * AND THE EPOCH IS NOT THE ONLY WAY TO BE STALE (2026-09-05). It tracks the READING, which is
   * what the answer is about — and a camera that failed in the meantime changes nothing about the
   * reading while changing everything about what the panel should be saying. So a refinement
   * landing after "The camera did not open" replaced that sentence with a misread notice and
   * reported 'scanning' over a null device: the user was told to show a side again by a scanner
   * with no camera. A failure notice outranks a better explanation of a refusal, and the test is
   * `clearCameraFault`'s — is the sentence a failure pinned still the one on screen.
   */
  diagnose(result, publish) {
    if (result.misreadCount !== null) {
      publish(result, true);
      return;
    }
    const epoch = ++this.diagnosisEpoch;
    const inPlace = this.inPlace();
    const faces = inPlace ? this.positionFaces() : this.faces;
    const settle = (diagnosis) => inPlace ? this.fromPositions(diagnosis) : diagnosis;
    const reply = this.misread.request({ epoch, faces, fixedRotation: inPlace }, (r) => {
      if (r.epoch !== this.diagnosisEpoch) return;
      if (this.cameraFault !== null && this.notice === this.cameraFault) return;
      publish(decided(result, settle(r.diagnosis)), false);
    });
    publish(reply ? decided(result, settle(reply.diagnosis)) : result, true);
  }
  /** Refused: keep every capture, and say what would make it a cube. */
  finishRefused(result) {
    this.confirmed = {};
    this.awaiting = null;
    this.diagnose(result, (r, first) => this.publishRefusal(r, first));
  }
  /**
   * Say a refusal out loud: the public event, the pinned notice, the transient line.
   *
   * Run once per refusal and once more per diagnosis that lands for it, so `scan-invalid` carries
   * the same null-then-value shape `misreadCount` has — a host sees the refusal immediately and
   * the count when there is one, rather than waiting seconds for either.
   */
  publishRefusal(result, first) {
    this.suspects = result.suspects ?? [];
    this.dispatchEvent(new CustomEvent("scan-invalid", { detail: result }));
    const camera = this.misreadNotice(result, {
      one: "If it is wrong, tap it and pick the colour you see; if it is right, show that side again to re-read it.",
      lead: result.misreadFace ? void 0 : "At least %1 stickers do not fit a real cube \u2014 too many to tell which.",
      many: result.misreadFace ? "Show the %2 side to the camera again \u2014 it will be read fresh." : `Start the scan over in whiter light; red and orange are the colours it confuses most. ${RE_READ_LINE}`,
      params: result.misreadFace ? [GUIDE[result.misreadFace].color] : [],
      action: result.misreadFace ? void 0 : { label: "Start over", kind: "restart" }
    });
    const { notice, line } = classifyRefusal(result, camera);
    this.notice = notice;
    if (first) this.loop("scanning", this.tinted("err", line));
    else this.report("scanning", this.tinted("err", line));
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
      span.title = this.faces[face] ? `${g.color} \u2014 captured` : `${g.color} \u2014 needed`;
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
    const shownAgain = this.shownAgain;
    this.shownAgain = false;
    const message = parts.map((p) => typeof p === "string" ? p : p.textContent ?? "").join("");
    this.lastLine = message;
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
          sides: this.sidesHeld(),
          live: this.live,
          settling: this.settling(),
          seen: this.seen,
          shownAgain,
          device: this.cam.device,
          confirm: this.awaiting,
          runtime: this.cam.runtime,
          notice: this.notice,
          suspects: [...this.suspects],
          complete: this.finished,
          scheme: this.scheme
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
function classifyRefusal(result, camera) {
  if (camera) {
    return {
      notice: camera,
      line: camera.action ? "That isn't a solvable cube yet \u2014 start the scan over, or show one side again." : "That isn't a solvable cube yet \u2014 fix a sticker, or show a side again."
    };
  }
  if (result.schemeAmbiguous) {
    return {
      notice: {
        title: "Which colour is under white?",
        tone: "err",
        body: "Every side is read, but these readings differ only in which colour sits under white \u2014 blue or yellow \u2014 and no extra look can tell them apart. Turn any one face a quarter turn, then start the scan over to read the changed cube."
      },
      line: "This cube reads two ways that differ only in its colours \u2014 turn any one face a quarter turn, then start over."
    };
  }
  if (result.ambiguous) {
    return {
      notice: {
        title: "Too symmetric to tell",
        tone: "err",
        body: "This cube reads the same several ways, and no extra look can split them. Turn any one face a quarter turn, then start the scan over to read the changed cube."
      },
      line: "This cube reads the same several ways \u2014 turn any one face a quarter turn, then start over."
    };
  }
  return {
    notice: {
      title: "That doesn't read as a solvable cube",
      tone: "err",
      body: `Too much of the cube was read wrong to say where. Show the sides to the camera again \u2014 each one is read fresh \u2014 or start the scan over.`
    },
    line: "That isn't a solvable cube yet \u2014 fix a sticker, or show a side again."
  };
}
function decided(result, diagnosis) {
  const { misreadCount: _checking, ...settled } = result;
  return { ...settled, ...diagnosis };
}
if (!customElements.get("ai-scan-panel")) {
  customElements.define("ai-scan-panel", AiScanPanel);
}
export {
  AiScanPanel,
  classifyRefusal,
  createModelRunner,
  decodeDetections,
  defaultThreadCount,
  disposeParkedDetector,
  fitFace,
  nms,
  parkedDetector,
  preferredProviders,
  preprocess,
  seenIn,
  sideClaimed
};
