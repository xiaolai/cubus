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
function summariseConfidence(conf, threshold) {
  let min = 1;
  const lowConfidence = [];
  conf.forEach((c, i) => {
    if (c < min) min = c;
    if (c < threshold) lowConfidence.push(i);
  });
  return { confidence: min, lowConfidence };
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
    // top score — which includes every sticker a CALLER had already decided on other evidence.
    // `resolveCentres` is exactly that caller: `withCentre` overwrites each filed side's centre
    // with its slot's colour, so the argmax reading counts six centres as "repaired" and D1 would
    // demand a second look at a colour the repair never touched. What D1 is about is a sticker
    // whose colour NOBODY observed, so the comparison is with the colour the capture carries.
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
function assembleWithin(faces, threshold, confirmed, options, maxRepairCost, allowPaint = true, originals) {
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
    return assembleWithin(
      candidate,
      threshold,
      confirmed,
      options,
      maxRepairCost,
      allowPaint,
      asRead
    );
  };
  const all = SCHEMES.flatMap((scheme) => solvableReadings(bySlot, scheme));
  if (all.length === 0) {
    const repair = repairByCounts(faces, maxRepairCost);
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
function withCentre(capture, colour) {
  if (capture.colors[4] === colour) return capture;
  const colors = [...capture.colors];
  colors[4] = colour;
  if (!capture.scores) return { ...capture, colors };
  const scores = capture.scores.map((row) => [...row]);
  scores[4] = scores[4].map((_, c) => c === colour ? 1 : 0);
  return { ...capture, colors, scores };
}
function placedBy(slots) {
  const placed = {};
  slots.forEach((slot, i) => {
    placed[slot] = i;
  });
  return placed;
}
function orderings(items) {
  if (items.length <= 1) return [[...items]];
  return items.flatMap(
    (item, i) => orderings([...items.slice(0, i), ...items.slice(i + 1)]).map((rest) => [item, ...rest])
  );
}
var MAX_CENTRE_FILINGS = 24;
function resolveCentres(named, unnamed, threshold = LOW_CONFIDENCE_THRESHOLD, options = {}, confirmed = {}, budget = MAX_CENTRE_FILINGS) {
  const free = FACES.filter((face) => !named[face]);
  if (unnamed.length < 1 || unnamed.length !== free.length) {
    return {
      result: reject(
        "a centre resolution needs at least one unnamed side, exactly as many as the slots no side holds"
      )
    };
  }
  const claimed = [];
  for (const side of unnamed) {
    if (side.centreClaim === null) {
      claimed.push(null);
      continue;
    }
    const centre = side.centreClaim ?? side.capture.colors[4];
    if (centre === void 0 || !isColour(centre)) {
      return {
        result: reject(`an unnamed capture's centre colour ${centre} is not one of the six`)
      };
    }
    claimed.push(centre);
  }
  const all = orderings(free);
  if (all.length > budget) {
    return {
      result: reject(
        `a centre resolution over ${all.length} filings is past the budget of ${budget}`
      ),
      assessed: { filings: all.length, budget, truncated: true }
    };
  }
  const filings = all.map((slots) => {
    const faces = { ...named };
    slots.forEach((slot, i) => {
      faces[slot] = withCentre(unnamed[i].capture, colourOfSlot(slot));
    });
    return { slots, faces };
  });
  const assessed = filings.map((f) => ({
    ...f,
    result: assembleWithin(
      f.faces,
      threshold,
      confirmed,
      { ...options, diagnose: false },
      Number.POSITIVE_INFINITY,
      // NO PIXEL PATH HERE. It names its groups from the centres, and this is the one situation
      // where a centre is already known to be wrong — the filings differ by which centre was
      // misread. Left on, it makes a WRONG filing assemble too: measured 2026-09-17 on the 140
      // community sets, it turned one of v3's refusals into a legal cube that was not the user's,
      // which is the failure this whole file exists to prevent.
      false
    )
  }));
  const spent = { filings: all.length, budget, truncated: false };
  if (unnamed.length === 1) {
    const only = assessed[0];
    return {
      result: only.result,
      faces: only.faces,
      placed: placedBy(only.slots),
      decidedBy: "counting",
      assessed: spent
    };
  }
  const fits = assessed.filter(
    ({ result }) => result.valid || result.ambiguous === true || result.confirm !== void 0
  );
  if (fits.length === 1) {
    const [fit] = fits;
    return {
      result: fit.result,
      faces: fit.faces,
      placed: placedBy(fit.slots),
      decidedBy: "legality",
      assessed: spent
    };
  }
  const claims = claimed.filter((c) => c !== null);
  const unread = claimed.length - claims.length;
  const duplicated = claims.find((c, i) => claims.indexOf(c) !== i) ?? (unread === 0 ? claims[0] : void 0);
  const conflict = (legalFilings) => {
    if (duplicated === void 0) {
      return {
        result: reject(
          legalFilings === 0 ? "sides whose centres never settled, and no way of filing them is a legal cube" : "sides whose centres never settled, and more than one way of filing them is a legal cube",
          { unreadCentres: unread, legalFilings }
        )
      };
    }
    const shared = slotOf(duplicated);
    const missing = free.find((slot) => !claims.includes(colourOfSlot(slot))) ?? free[0];
    return {
      result: reject(
        legalFilings === 0 ? "sides read with the same centre colour, and no way of filing them is a legal cube" : "sides read with the same centre colour, and more than one way of filing them is a legal cube",
        { centreConflict: { shared, missing, legalFilings } }
      )
    };
  };
  if (fits.length > 1) return conflict(fits.length);
  return byConfidence(claimed, claims, unnamed, free, assessed, conflict);
}
function byConfidence(claimed, claims, unnamed, free, assessed, conflict) {
  if (claimed.some((c) => c === null)) return conflict(0);
  const keeps = /* @__PURE__ */ new Map();
  for (const colour of new Set(claims)) {
    const claimants = claims.flatMap((c, i) => c === colour ? [i] : []);
    const ranked = [...claimants].sort(
      (a, b) => unnamed[b].centreConfidence - unnamed[a].centreConfidence
    );
    const [top, next] = ranked;
    if (next !== void 0 && unnamed[top].centreConfidence === unnamed[next].centreConfidence) {
      return conflict(0);
    }
    keeps.set(colour, top);
  }
  const movers = unnamed.map((_, i) => i).filter((i) => keeps.get(claims[i]) !== i);
  const open = free.filter((slot) => !keeps.has(colourOfSlot(slot)));
  if (movers.length !== 1 || open.length !== 1) return conflict(0);
  const chosen = assessed.find(
    ({ slots }) => slots.every((slot, i) => i === movers[0] ? slot === open[0] : slot === slotOf(claims[i]))
  );
  if (!chosen) return conflict(0);
  return {
    result: chosen.result,
    faces: chosen.faces,
    placed: placedBy(chosen.slots),
    decidedBy: "confidence"
  };
}

// view/centres-protocol.ts
function handleCentresRequest(request) {
  return {
    epoch: request.epoch,
    resolution: resolveCentres(
      request.named,
      request.unnamed,
      void 0,
      { diagnose: false },
      {},
      request.budget ?? MAX_CENTRE_FILINGS
    )
  };
}

// view/centres-worker.ts
self.addEventListener("message", (ev) => {
  self.postMessage(handleCentresRequest(ev.data));
});
