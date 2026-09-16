// ==========================================
// GLOBAL VARIABLES AND AUXILIARY FUNCTIONS (WASM)
// ==========================================

const defaultMessageHandler = function (msg, level) {
    switch (level) {
        case 100:
        case 200:
            break;
        case 300:
            break;
        default:
            if (typeof Module !== 'undefined' && Module._free) {
                Module._free();
            }
            break;
    }
};

let fileStatus = {
    segment: false,
    transition: false,
    reset: function () {
        this.segment = false;
        this.transition = false;
    },
    isDone: function() {
        return this.segment !== false && this.transition !== false;
    }
};

var res;
var maxPrecision = 6;
let vueAppInstance = null; // Internal reference to Vue

function initFileForWasm(fileInput, targetName, callback) {
    const FILEPATH = '/';
    if (!fileInput || fileInput.files.length == 0) {
        return;
    }

    let file = fileInput.files[0];
    let fr = new FileReader();
    fr.onload = function () {
        let data = new Uint8Array(fr.result);
        
        // --- JAVÍTÁS 1: A pontos elérési út kezelése (dupla perjel elkerülése) ---
        let fullPath = FILEPATH + targetName; // Ha FILEPATH = '/', akkor ez '/segment' vagy '/transition'
        
        // --- JAVÍTÁS 2: Erőteljesebb Emscripten FS tisztítás ---
        try {
            let stat = FS.analyzePath(fullPath);
            if (stat.exists) {
                FS.unlink(fullPath);
                console.log("Sikeresen unlinked a WASM FS-ből:", fullPath);
            }
        } catch(e) {
            // Ha még nem létezik, az analyzePath hibát dobhat, ezt csendben elkapjuk
        }
        
        // Létrehozzuk a friss fájlt a virtuális lemezen
        FS.createDataFile(FILEPATH, targetName, data, true, true, true);
        
        // Visszaadjuk a sikeres callback-et a pontos elérési úttal
        callback(file, fullPath);
    };
    fr.readAsArrayBuffer(file);
}

function doStart(nqn, dobootstrap, botiter, unc, minSize) {
	
	window.downloadedFilesList = [];
    if (typeof vueAppInstance !== 'undefined' && vueAppInstance) {
        vueAppInstance.$forceUpdate();
    }
	
    if (fileStatus.isDone()) {
        if (vueAppInstance) {
            vueAppInstance.log('MARVEL calculation starts...', 'SYSTEM', '#33ff33');
        }
        
        setTimeout(() => {
            try {
                // Átadjuk az összes régi és új (unc, minSize) paramétert a C++ felé
                res = Module.processInputFile(
                    fileStatus.segment.target,
                    fileStatus.segment.original.name,
                    fileStatus.transition.target,
                    fileStatus.transition.original.name,
                    dobootstrap,
                    botiter,
                    nqn,
                    unc,       
                    minSize    
                );
                
                Module.runMARVEL();
                
                // Intelligens belső hibaellenőrzés
                let errorMessage = Module.getResultStorage().getErrorMessage();
                
               if (errorMessage && errorMessage.trim() !== "") {
					if (vueAppInstance) {
						let cleanError = errorMessage.replace(/<br\s*\/?>/gi, ' ');
						vueAppInstance.log(`MARVEL Engine error: ${cleanError}`, 'ERROR', '#d9534f');
						vueAppInstance.isRunning = false;
						vueAppInstance.showRerunButton = true;
					}
					$("#ofiles").css('display', 'none');
					return;
				}

				// Lefuttatjuk a feldolgozást (ami kiírja a SUCCESS-t és a REPORT-okat sorban)
				postProcess();
                
            } catch (err) {
                if (vueAppInstance) {
                    vueAppInstance.log(`MARVEL Runtime Error: ${err.message}`, 'ERROR', '#d9534f');
                    vueAppInstance.isRunning = false;
                    vueAppInstance.showRerunButton = true;
                }
            }
        }, 100);
    } else {
        if (vueAppInstance) {
            vueAppInstance.log('Waiting for the other file to load...', 'INFO', '#00ffff');
        }
    }
}

// ==========================================
// JQUERY EVENT HANDLERS FOR THE BAD LINES TABLE
// ==========================================

$(document).on('click', '.incunc', function(){
    // 1. Kiszedjük a referenciát és a kiszámolt optimális bizonytalanságot közvetlenül a HTML sorból!
    var actRef = $(this).attr("ref").trim();	
    
    // Megkeressük a gombhoz tartozó sorban a harmadik oszlop (Opt. unc.) tartalmát
    var row = $(this).closest('tr');
    var optUncText = row.find('td:nth-child(3)').text().trim(); // Pl: "1.230e-03"
    var optUncVal = parseFloat(optUncText);

    if (isNaN(optUncVal)) {
        console.error("Nem sikerült beolvasni az optimális bizonytalanságot a HTML-ből!");
        return;
    }

    // Vizuális visszajelzés a felületen
    row.css("background-color","#dff0d8");
    $(this).remove();
    
    // 2. --- SZÖVEG ALAPÚ FÁJLFRISSÍTÉS (TELJESEN C++ MENTESEN) ---
    try {
        if (fileStatus.transition && fileStatus.transition.target) {
            let targetFile = fileStatus.transition.target;
            
            // Beolvassuk a virtuális fájl tartalmát
            let currentContentUint8 = FS.readFile(targetFile);
            let currentText = new TextDecoder("utf-8").decode(currentContentUint8);
            
            let lines = currentText.split('\n');
            let updatedLines = [];
            let newUncStr = optUncVal.toExponential(6);
            
            for (let line of lines) {
                let trimmed = line.trim();
                if (trimmed === "" || trimmed.startsWith("&")) {
                    updatedLines.push(line);
                    continue;
                }
                
                // Ha a sor végén ott van a keresett referenciánk (actRef)
                if (trimmed.endsWith(actRef)) {
                    let tokens = trimmed.split(/\s+/);
                    let uncSelectValue = parseInt(document.getElementById('uncSelect').value) || 1;
                    
                    if (uncSelectValue === 1 && tokens.length >= 3) {
                        // UNC 1: 2. oszlop (index 1) a bizonytalanság
                        tokens[1] = newUncStr;
                    } else if (uncSelectValue === 2 && tokens.length >= 4) {
                        // UNC 2: 3. oszlop (index 2) a bizonytalanság
                        tokens[2] = newUncStr;
                    }
                    
                    updatedLines.push(tokens.join(" "));
                } else {
                    updatedLines.push(line);
                }
            }
            
            // Elmentjük a virtuális fájlrendszerbe
            let newText = updatedLines.join("\n");
            FS.writeFile(targetFile, newText);
            console.log("WASM FS fájl SIKERESEN frissítve (100% kliensoldali HTML-ből):", targetFile);
        }
    } catch(err) {
        console.error("Hiba a WASM FS fájl mentése közben:", err);
    }
    
    if (vueAppInstance) {
        vueAppInstance.showRerunButton = true;
        vueAppInstance.log(`Uncertainty increased and file safely auto-saved: ${actRef}`, 'WARN', '#f0ad4e');
    }
});

$(document).on('click', '.delete', function(){
    var actRef = $(this).attr("ref").trim();	
    var nbBTr = Module.getResultStorage().getBadlines().size();
    for(var i=0; i < nbBTr; i++) {
        var bref = Module.getResultStorage().getBadlines().get(i).getRef().trim();
        if(actRef == bref) {
            // Module.getResultStorage().getBadlines().get(i).delTr();
        }
    }

    $(this).parent().parent().css("background-color","#dff0d8");
    $(this).remove();
    
    if (vueAppInstance) {
        vueAppInstance.showRerunButton = true;
        vueAppInstance.log(`Row marked for deletion: ${actRef}`, 'WARN', '#f0ad4e');
    }
});

// ==========================================
//DOWNLOAD, VIEW AND EXPORT FILE
// ==========================================

function downloadFile(path, mime) {
    mime = mime || "plain/text";
    let content = Module.FS.readFile(path);
 
    var a = document.createElement('a');
    a.download = path.split('\\').pop().split('/').pop();
    a.href = URL.createObjectURL(new Blob([content], {type: mime}));
    a.style.display = 'none';

    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
        URL.revokeObjectURL(a.href);
        document.body.removeChild(a);
    }, 2000);
}

function openNewTab(path, mime) {
   mime = mime || "plain/text";	
   let content = Module.FS.readFile(path);	
   const blb = new Blob([content], {type: "text/plain"});
   const reader = new FileReader();
   
   reader.addEventListener('loadend', (e) => {
      const text = e.srcElement.result;
      var myWindow = window.open("", '_blank');
      
      // SECURITY CHECK: If your browser has blocked the pop-up window
      if (!myWindow) {
          alert("Your browser has blocked pop-ups! Please allow pop-ups to view this page.");
          return;
      }
      
      let textToWrite = text.replace(/\n/g, "<br/>");
      myWindow.document.writeln(textToWrite);
      setTimeout(() => window.URL.revokeObjectURL(text), 100);
   });

   reader.readAsText(blb);
}
function download(data, filename, type) {
    var a = document.createElement("a"),
        file = new Blob([data], { type: type });
    if (window.navigator.msSaveOrOpenBlob) {
        window.navigator.msSaveOrOpenBlob(file, filename);
    } else {
        var url = URL.createObjectURL(file);
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        setTimeout(function () {
            document.body.removeChild(a);
            window.URL.revokeObjectURL(url);
        }, 0);
    }
}

function downloadNewTrans() {
    /*var vtext = "";
    var nbBTr = Module.getResultStorage().getTransitions().size();
    var unit = "";
    var unc = 0.0;
	console.log("dsfds");

    for(var i=0; i < Module.getResultStorage().getDeletedLines().size(); i++) {
        vtext += Module.getResultStorage().getDeletedLines().get(i).getFreq() + " " +
                 Module.getResultStorage().getDeletedLines().get(i).getUnc() + " " +
                 Module.getResultStorage().getDeletedLines().get(i).getUnc() + " " +
                 Module.getResultStorage().getDeletedLines().get(i).getAssu() + " " +
                 Module.getResultStorage().getDeletedLines().get(i).getAssl() + " " +
                 Module.getResultStorage().getDeletedLines().get(i).getRef() + "\n";
    }
    
    for(var i=0; i < nbBTr; i++) {
        unit = Module.getResultStorage().getTransitions().get(i).getUnit();
        // Retrieve the uncertainty from the corresponding WASM transient object
        let actualUnc = Module.getResultStorage().getTransitions().get(i).getUnc();
        unc = actualUnc;
        
        if(unit == "Hz") {
            unc = actualUnc * 2.99792458E10;
        }
        if(unit == "kHz") {
            unc = actualUnc * 2.99792458E10 / 1E3;
        }
        if(unit == "MHz") {
            unc = actualUnc * 2.99792458E10 / 1E6;
        }
        if(unit == "GHz") {
            unc = actualUnc * 2.99792458E10 / 1E9;
        }
        if(unit == "THz") {
            unc = actualUnc * 2.99792458E10 / 1E12;
        }
        
        vtext += Module.getResultStorage().getTransitions().get(i).getOfreq() + " "
                + Module.getResultStorage().getTransitions().get(i).getUncorig() + " " + unc.toExponential(3) + " "
                + Module.getResultStorage().getTransitions().get(i).getNode1().getId() + " "
                + Module.getResultStorage().getTransitions().get(i).getNode2().getId() + " "
                + Module.getResultStorage().getTransitions().get(i).getRef() + "\n";
    }
    
    var d = new Date();
    var filename = "transitions_" + d.getDate() + "_" + (d.getMonth()+1) + "_" + d.getFullYear() + "_" + d.getHours() + "_" + d.getMinutes() + ".txt";
    download(vtext, filename, "text/plain;charset=utf-8");*/
}

function reset() {
    fileStatus.reset();
    document.getElementById('output').innerHTML = 'Loading...';
}

// ==========================================
//LAUNCHING AND CONFIGURING THE VUE 3 APPLICATION
// ==========================================

window.downloadedFilesList = [];

document.addEventListener('DOMContentLoaded', () => {
    const { createApp } = Vue;

    try {
        const app = createApp({
            data() {
				return {
					nqn: 6,
					unc: 2,                  // <--- Ez marad a C++ motor oszlopbeállítása (1 vagy 2)
					
					// --- CSÚSZKA ÉS FELTÉTELES JELENLÉT ---
					sliderUnc: 0.05,         // <--- ÚJ: Ez a csúszka tényleges értéke (szűrés/bizonytalanság)
					nbBTr: 0,
					showSlider: false,       // Megjelenjen-e a csúszka (ha nbBTr > 10)
					manualUncChecked: false, // Kézi bepipálást követő állapot
					uncertaintyThreshold: 10, // A küszöbérték (bad lines > 10)

					// --- EGYÉB RENDSZERÁLLAPOTOK ---
					showRerunButton: false,
					runBootstrap: false,
					botiter: 100,
					isRunning: false,
					hasCalculated: false,
					logs: [],
					outputFiles: [],
					activeTab: 'badLines',
					showBadHelp: false
				}
			},
            mounted() {
                // We save the Vue instance reference for external functions
                vueAppInstance = this;
                
                this.log('MARVEL 4.5 offline engine successfully loaded.', 'SYSTEM', '#33ff33');
                this.log('Please select the Segment and Transition files to start.', 'INFO', '#00ffff');
            },
            methods: {
                log(text, type = 'INFO', color = '#00ff00') {
                    const time = new Date().toLocaleTimeString();
                    this.logs.push({ time, type, text, color });
                    setTimeout(() => {
                        const consoleBox = document.getElementById('logConsole');
                        if (consoleBox) consoleBox.scrollTop = consoleBox.scrollHeight;
                    }, 40);
                },
                
                runMarvel() {
                    this.isRunning = true;
                    this.showRerunButton = false;
                    this.outputFiles = [];
                    
                    // Korábbi táblázatok és hibaüzenetek ürítése
                    $("#eltext, #els, #btext, #btrs, #bnote").html("");
                    
                    // A fájl státuszok teljes tisztítása (így megvárják egymást!)
                    if (typeof fileStatus !== 'undefined' && fileStatus.reset) {
                        fileStatus.reset();
                    }
                    fileStatus.segment = { original: null, target: null };
                    fileStatus.transition = { original: null, target: null };
                    
                    this.log('Processing new files...', 'START', '#ffff00');
                    
                    let dobootstrap = this.runBootstrap ? 1 : 0;
                    let uncValue = parseInt(document.getElementById('uncSelect').value) || 1;
                    let minSizeValue = 1;
                    
                    // Segment fájl betöltése
                    initFileForWasm(document.getElementById('segmentFile'), 'segment', (originalFile, targetPath) => {
                        fileStatus.segment = { original: originalFile, target: targetPath };
                        this.log(`Segment file loaded: ${originalFile.name}`, 'FS', '#00ffaa');
                        
                        if (fileStatus.transition.target) {
                            doStart(this.nqn, dobootstrap, this.botiter, uncValue, minSizeValue);
                        }
                    });
                    
                    // Transition fájl betöltése
                    initFileForWasm(document.getElementById('transitionFile'), 'transition', (originalFile, targetPath) => {
                        fileStatus.transition = { original: originalFile, target: targetPath };
                        this.log(`Transition file loaded: ${originalFile.name}`, 'FS', '#00ffaa');
                        
                        if (fileStatus.segment.target) {
                            doStart(this.nqn, dobootstrap, this.botiter, uncValue, minSizeValue);
                        }
                    });
                },
                
                rerunMarvel() {
					this.isRunning = true;
					this.log('Rerun MARVEL on modified parameters matrix...', 'RERUN', '#ffaa00');

					setTimeout(() => {
						try {
							let dobootstrap = this.runBootstrap ? 1 : 0;
							let uncValue = parseInt(document.getElementById('uncSelect').value) || 1;
							let minSizeValue = 1;

							// 1. Újra-feldolgozás a WASM memóriájában lévő fájlokból az ÚJ uncValue-val!
							res = Module.processInputFile(
								fileStatus.segment.target,
								fileStatus.segment.original.name,
								fileStatus.transition.target,
								fileStatus.transition.original.name,
								dobootstrap,
								this.botiter,
								this.nqn,
								uncValue,     // <-- ITT KAPJA MEG AZ ÚJ MEGEMELÉST!
								minSizeValue
							);

							// 2. Számolási mag futtatása
							Module.runMARVEL();

							// 3. C++ hibaellenőrzés
							let errorMessage = Module.getResultStorage().getErrorMessage();
							if (errorMessage && errorMessage.trim() !== "") {
								let cleanError = errorMessage.replace(/<br\s*\/?>/gi, ' ');
								this.log(`MARVEL Engine error: ${cleanError}`, 'ERROR', '#d9534f');
								$("#ofiles").css('display', 'none');
								return;
							}

							// 4. Eredmények és új transitions fájl kiíratása
							postProcess();

							//this.log('MARVEL rerun completed successfully!', 'SUCCESS', '#33ff33');

						} catch (err) {
							console.error("Rerun error:", err);
							this.log(`MARVEL Runtime Error: ${err.message}`, 'ERROR', '#d9534f');
						} finally {
							this.isRunning = false;
							this.showRerunButton = true;
						}
					}, 100);
				},
                triggerDownload(file) {
                    downloadFile(file);

                    if (window.downloadedFilesList && !window.downloadedFilesList.includes(file)) {
                        window.downloadedFilesList.push(file);
                    }
                    
                    this.$forceUpdate(); 
                },
                
                isDownloaded(file) {
                    if (window.downloadedFilesList) {
                        return window.downloadedFilesList.includes(file);
                    }
                    return false;
                },
                
                triggerView(file) {
                    openNewTab(file);
                },
                
                triggerNewTransDownload() {
                    downloadNewTrans();
                }
            } // <-- Vue methods lezárása
        }); // <-- createApp paraméterének lezárása

        // Vue globális hiba elkapása
        app.config.errorHandler = (err, vm, info) => {
            console.error("VUE INTERNAL ERROR:", err, info);
        };

        window.vueApp = app.mount('#app');
        console.log("Vue successfully attempted to load into #app!");

    } catch (vueError) {
        console.error("Critical error when starting Vue:", vueError);
    }
});

// ==========================================
// POST-TREATMENT OF RESULTS
// ==========================================
function postProcess() {
    // Ha végzett a számolás, leállítjuk a betöltést és aktiváljuk a Rerun állapotot!
    if (vueAppInstance) {
        vueAppInstance.isRunning = false;
        vueAppInstance.hasCalculated = true;
		
		// 1. ELŐSZÖR A SUCCESS ÜZENET
        vueAppInstance.log('The calculation was successful!', 'SUCCESS', '#33ff33');
    }

    let container = document.getElementById('output');

    let errorMessage = Module.getResultStorage().getErrorMessage();
    $("#errorM").html("");
    if (errorMessage != "") {
        let econtent = "<div class='alert alert-danger' role='alert'>" + errorMessage + "</div><br/>";
        $("#errorM").html(econtent);
        if (vueAppInstance) {
            vueAppInstance.log(`MARVEL Engine error message: ${errorMessage}`, "ERROR", "#d9534f");
        }
    }
   // 1. ÖSSZESÍTŐ ADATKIOLVASÁS ÉS DINAMIKUS NÉV ELŐÁLLÍTÁSA
    let nbBTr = Module.getResultStorage().getBadlines().size();
    let nbEl = Module.getResultStorage().getEnergies().size();
    let dynamicFileName = "NewTransitions_" + nbBTr + ".txt";

    // ------------------------------------------------------------------------
    // KOMPONENSEK ADATAINAK KINYERÉSE AZ FS-BŐL (OUT_COMPONENTS / components.txt)
    // ------------------------------------------------------------------------
    let numComponents = 0;
    let maxComponentSize = 0;

    try {
        if (Module.FS.analyzePath("Components.txt").exists) {
            let compContentUint8 = Module.FS.readFile('Components.txt');
            let compText = new TextDecoder("utf-8").decode(compContentUint8);
            let lines = compText.split(/\r?\n/);

            for (let line of lines) {
                let trimmed = line.trim();
                // Keresés: pl. "1. component   nbEL= 56  nbTR= 120"
                if (trimmed.includes(". component") && trimmed.includes("nbEL=")) {
                    numComponents++;

                    // Az első megtalált elem a legnagyobb (a C++ rendezés miatt)
                    if (maxComponentSize === 0) {
                        let match = trimmed.match(/nbEL=\s*(\d+)/);
                        if (match && match[1]) {
                            maxComponentSize = parseInt(match[1], 10);
                        }
                    }
                }
            }
        }
    } catch (e) {
        console.warn("Nem sikerült beolvasni a komponenseket az FS-ből:", e);
    }

    // ------------------------------------------------------------------------
    // FÁJL ÁTNEVEZÉSE AZ EMSCRIPTEN VIRTUÁLIS FÁJLRENDSZERÉBEN (FS)
    // ------------------------------------------------------------------------
    try {
        if (Module.FS.analyzePath("NewTransitions.txt").exists) {
            Module.FS.rename("NewTransitions.txt", dynamicFileName);
        }
    } catch (e) {
        console.warn("Nem sikerült átnevezni a fájlt az FS-ben:", e);
    }

    // 2. ÖSSZESÍTŐ ÜZENET LOGOLÁSA A VUE KONZOLRA
    if (vueAppInstance && typeof vueAppInstance.log === "function") {
        // 1. Sor: Energiák (Zöld)
        vueAppInstance.log(
            `Total energy levels found: ${nbEl}`,
            "REPORT",
            "#5cb85c"
        );

        // 2. Sor: Komponensek száma (Kék/Info)
        if (numComponents > 0) {
            vueAppInstance.log(
                `Total components found: ${numComponents} (Largest: ${maxComponentSize} EL)`,
                "REPORT",
                "#0275d8"
            );
        }

        // 3. Sor: Bad Lines (Piros)
        vueAppInstance.log(
            `Total bad lines found: ${nbBTr}`,
            "REPORT",
            "#d9534f"
        );
    }

    let files = Module.getResultStorage().getOutputFiles();

    // 3. Vue kimeneti tömb frissítése a dinamikus névvel
    if (vueAppInstance) {
        let tempFiles = [];
        for (let i = 0; i < files.size(); i++) {
            let fName = files.get(i);
            if (fName.includes("NewTransitions")) {
                tempFiles.push(dynamicFileName);
            } else {
                tempFiles.push(fName);
            }
        }
        vueAppInstance.outputFiles = tempFiles;
    }

    // 4. HTML kimeneti lista kiírása (ha létezik a container div)
    if (container) {
        container.innerHTML = '';
        let content = '';
        for (let i = 0; i < files.size(); i++) {
            let fName = files.get(i);
            if (fName.includes("NewTransitions")) {
                content += '<li style="margin-bottom: 5px;"><strong style="display:inline-block; min-width: 260px;">' + dynamicFileName + ':</strong> <a href="javascript: downloadNewTrans(\'' + dynamicFileName + '\')">Download</a></li>';
            } else {
                content += '<li style="margin-bottom: 5px;"><strong style="display:inline-block; min-width: 260px;">' + fName + ':</strong> <a href="javascript: downloadFile(\'' + fName + '\')">Download</a> or <a href="javascript: openNewTab(\'' + fName + '\')"> View in browser</a></li>';
            }
        }
        container.innerHTML = '<ul style="list-style: none; padding-left: 0;">' + content + '</ul>';
    }

    $("#ofiles").css('display', 'block');
	
	
    // Energies
	
    var eltext = "<br/><h4>MARVEL Energies</h4><p>Table below contains only the first 100 energy levels. To see all energy levels download the EnergyLevels.txt file.</p>";
    $("#eltext").html(eltext);

    // MÓDOSÍTOTT TÁBLÁZAT: fixed layout, korlátozott szélesség, jobbra igazított számok
    var ELTable = "<table id='restable' class='table table-striped table-bordered table-condensed' style='width: 100%; max-width: 650px; table-layout: fixed;'>" +
        "<thead><tr>" +
        "<th style='text-align: left; width: 45%;'>Assignments</th>" +
        "<th style='text-align: right; width: 30%;'>Energy value / cm-1</th>" +
        "<th style='text-align: right; width: 25%;'>Unc / cm-1</th>" +
        "</tr></thead><tbody>";

    var countEL = 1;
    for (var i = 0; i < nbEl; i++) {
        if (parseFloat(Module.getResultStorage().getEnergies().get(i).getEnergy()) >= 0.0) {
            ELTable += "<tr>" +
                "<td style='text-align: left; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;'>" + 
                    Module.getResultStorage().getEnergies().get(i).getId() + 
                "</td>" +
                "<td style='text-align: right;'>" + 
                    parseFloat(Module.getResultStorage().getEnergies().get(i).getEnergy()).toFixed(maxPrecision) + 
                "</td>" +
                "<td style='text-align: right;'>" + 
                    parseFloat(Module.getResultStorage().getEnergies().get(i).getUncFinal()).toFixed(maxPrecision) + 
                "</td></tr>";
            countEL++;
        }
        if (countEL > 100) break;
    }

    ELTable += "</tbody></table>";
    $("#els").html(ELTable);
    
    if ($('#restable').length) {
        $('#restable').DataTable({ 
            "order": [[ 1, "asc" ]],
            "autoWidth": false,
            "destroy": true
        });
    }

	// ========================================================================
    // 2. COMPONENTS FÜL FELÉPÍTÉSE (ITT A BESZÚRT RÉSZ!)
    // ========================================================================
    try {
        if (Module.FS.analyzePath("/Components.txt").exists) {
            let compContentUint8 = Module.FS.readFile('/Components.txt');
            let compText = new TextDecoder("utf-8").decode(compContentUint8);
            let lines = compText.split(/\r?\n/);

            let parsedComponents = [];
            let totalTransitions = 0;

            for (let line of lines) {
                let trimmed = line.trim();
                if (trimmed.includes(". component") && trimmed.includes("nbEL=")) {
                    let match = trimmed.match(/^(\d+)\.\s+component\s+nbEL=\s*(\d+)\s+nbTR=\s*(\d+)/);
                    if (match) {
                        let cId = parseInt(match[1], 10) - 1; // 0-s indexelés
                        let nbEL = parseInt(match[2], 10);
                        let nbTR = parseInt(match[3], 10);
                        
                        parsedComponents.push({ id: cId, nbEL: nbEL, nbTR: nbTR });
                        totalTransitions += nbTR;
                    }
                }
            }

            let numComponents = parsedComponents.length;
            let largestComp = parsedComponents.length > 0 ? parsedComponents[0].nbEL : 0;

            let compHtml = '<div style="padding: 5px; max-width: 400px;">';
            compHtml += '<p style="margin-bottom: 5px;"><strong>Number of components of the graph:</strong> ' + numComponents + '</p>';
            compHtml += '<p style="margin-bottom: 5px;"><strong>Largest component of the graph:</strong> ' + largestComp + '</p>';
            compHtml += '<p style="margin-bottom: 15px;"><strong>Number of transitions in file:</strong> ' + totalTransitions + '</p>';

			compHtml += '<table id="compTable" class="table table-striped table-bordered table-condensed" style="width: 100%; table-layout: fixed; margin-top: 10px;">';
			compHtml += '<thead><tr>';
			compHtml += '<th style="text-align: center; width: 80px; padding-right: 15px;">Comp. ID</th>';
			compHtml += '<th style="text-align: center; width: 110px;">Nb. of ELs</th>';
			compHtml += '<th style="text-align: center; width: 110px;">Nb. of TRs</th>';
			compHtml += '</tr></thead><tbody>';
			
            parsedComponents.forEach(function(c) {
                compHtml += '<tr>';
                compHtml += '<td>' + c.id + '</td>';
                compHtml += '<td>' + c.nbEL + '</td>';
                compHtml += '<td>' + c.nbTR + '</td>';
                compHtml += '</tr>';
            });

            compHtml += '</tbody></table></div>';

            let compElem = document.getElementById('componentsContainer');
            if (compElem) {
                compElem.innerHTML = compHtml;

                if ($.fn.DataTable.isDataTable('#compTable')) {
                    $('#compTable').DataTable().destroy();
                }

                $('#compTable').DataTable({
                    "pageLength": 10,
                    "order": [[ 0, "asc" ]]
                });
            }
        }
    } catch (e) {
        console.warn("Nem sikerült felépíteni a Components fület:", e);
    }


   // Bad lines
    console.log("nbBTR= " + nbBTr);

    var prnbTR = Math.min(100, nbBTr);
    var btext = "Table below contains only the first worst 100 bad lines. To see the details of bad lines, please check the BadLines.txt file." +
      " Click on the 'Inc. Unc.' button to increase the uncertainty of the line to the optimal value, or select multiple lines using the checkboxes and click 'Inc. selected unc.'. After increasing one or more uncertainties, you can run the MARVEL again.</p>";
    $("#btext").html(btext);

    // ------------------------------------------------------------------------
    // CSÚSZKA ADATELŐKÉSZÍTÉS: Tényleges Opt. unc. értékek kigyűjtése
    // ------------------------------------------------------------------------
    var badDataList = [];

    for (var i = 0; i < prnbTR; i++) {
        var unc_i = Module.getResultStorage().getBadlines().get(i).getOunc();
        var optunc_i = 1.01 * Module.getResultStorage().getBadlines().get(i).getMunc();
        
        badDataList.push({
            optUncNum: optunc_i,
            optUncStr: parseFloat(optunc_i).toExponential(3)
        });
    }

    // Csökkenő sorrendbe rendezzük a tényleges Opt. unc. értékek szerint
    badDataList.sort(function(a, b) { return b.optUncNum - a.optUncNum; });

    // Egyedi értékek megtartása a csúszka lépéseihez (küszöbértékek)
    var uniqueOptUncs = [];
    var seen = new Set();
    for (var i = 0; i < badDataList.length; i++) {
        if (!seen.has(badDataList[i].optUncStr)) {
            seen.add(badDataList[i].optUncStr);
            uniqueOptUncs.push(badDataList[i]);
        }
    }

    window.availableBadData = uniqueOptUncs;

    if (window.availableBadData.length === 0) {
        window.availableBadData = [{ optUncNum: 0.0001, optUncStr: "1.000e-4" }];
    }

    var maxIndex = window.availableBadData.length - 1;
    var leftOptUnc = window.availableBadData[0].optUncStr;
    var rightOptUnc = window.availableBadData[maxIndex].optUncStr;

   // 1. A gomb KÜLÖN (mindig megjelenik a Bad Lines fül tetején)
	let toolbarHtml = '<div style="margin-bottom: 15px; display: flex; align-items: center; gap: 35px; flex-wrap: wrap; background: #f8f9fa; padding: 12px; border-radius: 5px; border: 1px solid #ddd;">' +
		'<button type="button" class="btn btn-warning btn-sm" id="incSelectedUncBtn"><span class="glyphicon glyphicon-arrow-up"></span> Inc. selected unc.</button>';

	// 2. A csúszka rész CSAK akkor fűződik hozzá a dobozhoz, ha nbBTr > 10
	if (nbBTr > 10) {
		toolbarHtml += '<div style="display: flex; flex-direction: column; gap: 6px; border-left: 2px solid #ccc; padding-left: 20px;">' +
			'<!-- 1. SOR: Két soros címke -->' +
			'<label for="ratioSlider" style="margin: 0; font-weight: bold; font-size: 13px; line-height: 1.2;">' +
				'Auto-select Opt. unc threshold<br/>' +
				'<span style="font-weight: normal; font-size: 12px; color: #555;">(&ge; minimum value):</span>' +
			'</label>' +
			
			'<!-- 2. SOR: Csúszka + Értékek -->' +
			'<div style="display: flex; align-items: center; gap: 8px; white-space: nowrap;">' +
				'<span style="font-size: 12px; font-weight: bold; color: #333;">' + leftOptUnc + '</span>' +
				'<input type="range" id="ratioSlider" min="0" max="' + maxIndex + '" step="1" value="0" oninput="handleRatioIndexSlider(this.value)" style="width: 150px; cursor: pointer;">' +
				'<span style="font-size: 12px; font-weight: bold; color: #333;">' + rightOptUnc + '</span>' +
				'<span id="sliderValueBadge" class="label label-primary" style="font-size: 13px; padding: 4px 7px; background-color: #0255a5; font-weight: bold;">' + leftOptUnc + '</span>' +
				'<small id="selectedCountBadge" class="text-muted" style="font-size: 12px; font-weight: 600;">(0 selected)</small>' +
			'</div>' +
		'</div>';
	}

	// Bezárjuk a külső doboz div-jét
	toolbarHtml += '</div>';

	// 3. Összefűzzük az eszköztárat és a táblázatot
	var badlinestext = toolbarHtml + 
		"<table id='blines' class='table table-striped'><thead><tr>" +
		"<th style='text-align:center; width: 30px;'><input type='checkbox' id='selectAllBad' onclick='toggleSelectAllBad(this)'></th>" +
		"<th>Line tag</th><th>Orig. unc. </th><th>Opt. unc. </th><th>Ratio</th><th>Set Unc.</th></tr></thead><tbody>";
		
    var ref = "";
    var unc, optunc;
    var style = "";    
    var deleteable = 0;

    for (var i = 0; i < prnbTR; i++) {
        ref = Module.getResultStorage().getBadlines().get(i).getRef().trim();
        unc = Module.getResultStorage().getBadlines().get(i).getOunc();
        optunc = 1.01 * Module.getResultStorage().getBadlines().get(i).getMunc();
        var ratioVal = (optunc / unc).toFixed(5);

        style = "";
        if (optunc / unc > 100) {
            style = "style= 'background-color: #ea8992'";
            deleteable = 1;
        }

        // Checkbox data-optunc attribútummal ellátva a data-ratio helyett!
        var checkbox = '<input type="checkbox" class="bad-line-checkbox" ref="' + ref + '" data-optunc="' + optunc + '">';
        var incbutton = '<button type="button" class="btn btn-primary btn-sm" onclick="increaseSingleUnc(\'' + ref + '\')"><span class="glyphicon glyphicon-arrow-up"></span> Inc. unc.</button>';
        badlinestext += "<tr " + style + ">" +
            "<td style='text-align:center;'>" + checkbox + "</td>" +
            "<td>" + ref + "</td>" +
            "<td>" + parseFloat(unc).toExponential(3) + "</td>" +
            "<td>" + parseFloat(optunc).toExponential(3) + "</td>" +
            "<td>" + ratioVal + "</td>" +
            "<td>" + incbutton + "</td>" +
            "</tr>";
    }

    badlinestext += "</tbody></table>";
    $("#bnote").html("");
    if (deleteable == 1) {
        var bnote = '<div class="alert alert-danger" role="alert">The database contains transitions with extremly large optimal uncertainty (see the red row(s) in the Table below). These transitions must be deleted or reassigned in your database by hand.</div>';
        $("#bnote").html(bnote);
    }

    $("#btrs").html(badlinestext);
    
    if ($('#blines').length) {
        $('#blines').DataTable({ "order": [[ 3, "desc" ]] });
    }
}

// 1. Master checkbox (DataTables támogatással: az ÖSSZES oldalon kijelöli/megszünteti!)
function toggleSelectAllBad(master) {
    if ($.fn.DataTable.isDataTable('#blines')) {
        // A DataTables API segítségével az összes (akár rejtett) oldalon lévő checkboxot megkeressük
        var table = $('#blines').DataTable();
        table.$('.bad-line-checkbox').prop('checked', master.checked);
    } else {
        // Fallback, ha mégsem lenne DataTables
        $(".bad-line-checkbox").prop("checked", master.checked);
    }
}

// 2. Inline onclick hívásokhoz (Html gombból: onclick="increaseSingleUnc('line.18')")
function increaseSingleUnc(ref) {
    if (!ref) {
        console.error("Nem érkezett 'ref' paraméter az increaseSingleUnc függvénybe!");
        return;
    }
    processUncertaintyIncreases([ref.toString().trim()]);
}

// 3. Soronkénti gomb (.incunc)
$(document).on('click', '.incunc', function (e) {
    e.preventDefault();
    var $btn = $(this);
    var $row = $btn.closest('tr');
    var actRef = $btn.attr("ref") || $row.find('.bad-line-checkbox').attr("ref");
    
    if (actRef) {
        processUncertaintyIncreases([actRef.toString().trim()]);
    }
});

// 4. Tömeges emelés (#incSelectedUncBtn) - Minden oldalról begyűjti a kijelölteket!
$(document).on("click", "#incSelectedUncBtn", function (e) {
    e.preventDefault();
    var selectedRefs = [];

    if ($.fn.DataTable.isDataTable('#blines')) {
        var table = $('#blines').DataTable();
        // table.$() az összes oldalon lekéri a feltételnek megfelelő elemeket
        table.$(".bad-line-checkbox:checked").each(function () {
            var ref = $(this).attr("ref");
            if (ref) {
                selectedRefs.push(ref.toString().trim());
            }
        });
    } else {
        $(".bad-line-checkbox:checked").each(function () {
            var ref = $(this).attr("ref");
            if (ref) {
                selectedRefs.push(ref.toString().trim());
            }
        });
    }

    if (selectedRefs.length === 0) {
        alert("Please select at least one line using the checkboxes!");
        return;
    }

    processUncertaintyIncreases(selectedRefs);

    // Kijelölések törlése az összes oldalon
    if ($.fn.DataTable.isDataTable('#blines')) {
        $('#blines').DataTable().$('.bad-line-checkbox').prop("checked", false);
    } else {
        $(".bad-line-checkbox").prop("checked", false);
    }
    $("#selectAllBad").prop("checked", false);
});

/**
 * KÖZPONTI FÜGGVÉNY: DataTables API-t használ a sorok beolvasásához
 */
function processUncertaintyIncreases(targetRefs) {
    if (!targetRefs || targetRefs.length === 0) return;

    let updatesMap = {};
    var dtAvailable = $.fn.DataTable.isDataTable('#blines');
    var dtTable = dtAvailable ? $('#blines').DataTable() : null;

    // 1. ADATOK BEGYŰJTÉSE A TÁBLÁZATBÓL (Bármelyik oldalon is van a sor)
    targetRefs.forEach(function (ref) {
        var $row = null;

        if (dtAvailable) {
            // A DataTables teljes sor-halmazában keresünk rá a ref-re
            dtTable.rows().every(function() {
                var node = this.node();
                if (node) {
                    var $tr = $(node);
                    if ($tr.find('td:nth-child(2)').text().trim() === ref || $tr.find('[ref="' + ref + '"]').length > 0) {
                        $row = $tr;
                        return false; // Megvan, kilépünk a ciklusból
                    }
                }
            });
        } else {
            $row = $('#blines tbody tr').filter(function() {
                return $(this).find('td:nth-child(2)').text().trim() === ref || 
                       $(this).find('[ref="' + ref + '"]').length > 0;
            }).first();
        }

        if ($row && $row.length) {
            var optUncText = $row.find('td:nth-child(4)').text().trim();
            var optUncVal = parseFloat(optUncText);

            if (!isNaN(optUncVal)) {
                updatesMap[ref] = optUncVal.toExponential(6);
                
                // Vizuális visszajelzés a soron
                $row.css("background-color", "#dff0d8");
                $row.find('button').prop('disabled', true).text('Updated in FS');
                $row.find('.bad-line-checkbox').prop("checked", false);
            } else {
                console.warn("Nem sikerült beolvasni az Opt. unc értéket ehhez a ref-hez:", ref, optUncText);
            }
        }
    });

    if (Object.keys(updatesMap).length === 0) {
        console.error("Egyetlen kiválasztott sornál sem sikerült feldolgozni a bizonytalanságot!");
        return;
    }

    // 2. FÁJLFRISSÍTÉS AZ EMSCRIPTEN FS-BEN
    try {
        if (typeof fileStatus !== "undefined" && fileStatus.transition && fileStatus.transition.target) {
            let targetFile = fileStatus.transition.target;

            let currentContentUint8 = FS.readFile(targetFile);
            let currentText = new TextDecoder("utf-8").decode(currentContentUint8);
            
            let hasCRLF = currentText.includes("\r\n");
            let lines = currentText.split(/\r?\n/);

            let uncSelectElem = document.getElementById('uncSelect');
            let uncSelectValue = uncSelectElem ? (parseInt(uncSelectElem.value) || 1) : 1;
            let updatedLines = [];

            for (let line of lines) {
				let trimmed = line.trim();

				if (trimmed === "" || trimmed.startsWith("&")) {
					updatedLines.push(line);
					continue;
				}

				let matchedRef = Object.keys(updatesMap).find(ref => trimmed.endsWith(ref));

				if (matchedRef) {
					let newUncStr = updatesMap[matchedRef];
					let targetColumnIndex = (uncSelectValue === 1) ? 1 : 2; // 0-based index: 1-es oszlop a 2. elem, 2-es a 3.

					// A sort szóközök/tabok mentén elemekre bontjuk, megőrizve a szerkezetet
					let tokens = trimmed.split(/(\s+)/); // Megtartja a szóközöket is a szétválasztásnál!
					let colCounter = 0;

					for (let i = 0; i < tokens.length; i++) {
						// Ha az elem nem csupán szóköz, akkor az egy valódi oszlop/adat
						if (tokens[i].trim() !== "") {
							if (colCounter === targetColumnIndex) {
								tokens[i] = newUncStr; // Cseréljük a bizonytalanságot a formázott e-notációra
								break;
							}
							colCounter++;
						}
					}

					updatedLines.push(tokens.join(''));
				} else {
					updatedLines.push(line);
				}
			}

            let lineEnding = hasCRLF ? "\r\n" : "\n";
            let newText = updatedLines.join(lineEnding);
            
            let encoder = new TextEncoder();
            FS.writeFile(targetFile, encoder.encode(newText));

            console.log(`MARVEL FS frissítve (${Object.keys(updatesMap).length} sor):`, targetFile);
        } else {
            console.error("fileStatus.transition.target nem érhető el!");
        }
    } catch (err) {
        console.error("Hiba a MARVEL FS mentése során:", err);
    }

    // 3. VIZUÁLIS JELZÉS ÉS RE-RUN PROMPT
    if (typeof vueAppInstance !== "undefined" && vueAppInstance) {
        vueAppInstance.showRerunButton = true;
        vueAppInstance.log(
            `Uncertainty increased for ${Object.keys(updatesMap).length} line(s). Click "ReRun MARVEL" to calculate!`,
            'INFO',
            '#5bc0de'
        );
    }

    //alert(`${Object.keys(updatesMap).length} line(s) updated in the file system. Please click the "Re-run MARVEL" button to recalculate!`);
}

function handleRatioIndexSlider(selectedIndex) {
    if (!window.availableBadData || window.availableBadData.length === 0) return;

    var selectedItem = window.availableBadData[selectedIndex];
    var targetOptUnc = selectedItem.optUncNum; // A pontos numerikus Opt. unc.
    var displayOptUnc = selectedItem.optUncStr; // Az exponenciális szöveg a badge-re

    $('#sliderValueBadge').text(displayOptUnc);

    var count = 0;

    var selectorCallback = function() {
        // A sor saját numerikus Opt. unc értéke
        var itemOptUnc = parseFloat($(this).attr('data-optunc'));
        
        // Ha az adott sor Opt. unc értéke nagyobb vagy egyenlő a küszöbnél -> kijelöljük
        if (!isNaN(itemOptUnc) && itemOptUnc >= targetOptUnc) {
            $(this).prop('checked', true);
            count++;
        } else {
            $(this).prop('checked', false);
        }
    };

    if ($.fn.DataTable && $.fn.DataTable.isDataTable('#blines')) {
        var table = $('#blines').DataTable();
        table.rows().nodes().to$().find('.bad-line-checkbox').each(selectorCallback);
    } else {
        $('.bad-line-checkbox').each(selectorCallback);
    }

    $("#selectAllBad").prop("checked", false);
    $('#selectedCountBadge').text('(' + count + ' selected)');
}