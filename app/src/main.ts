// Точка входа приложения GeoRomb.
import './styles/app.css';
import { S } from './state.ts';
import { loadProjects, getCurrentProject } from './storage.ts';
import { loadPriceSettings } from './model/pricing.ts';
import { closeColorPicker, closeConfirm, closeSummary, openColorPicker, openGlassPicker, pickColor, runConfirm,
         updateColorSwatch, updateGlassSwatch } from './ui/dialogs.ts';
import * as projects from './features/projects.ts';
import * as elementForm from './features/elementForm.ts';
import * as elementView from './features/elementView.ts';
import * as view3d from './features/view3d.ts';
import * as catalog from './features/catalog.ts';
import * as cutting from './features/cutting.ts';
import * as warehouse from './features/warehouse.ts';
import * as priceScreens from './features/priceScreens.ts';
import * as backup from './features/backup.ts';
import * as menus from './features/menus.ts';
import * as navigation from './features/navigation.ts';
import * as about from './features/about.ts';
import * as license from './features/license.ts';
import { addExampleProject, seedExamplesOnce } from './features/examples.ts';
import { shareProjectPdf } from './features/pdf.ts';
import * as glassList from './features/glassList.ts';
import * as pdfI18n from './features/pdfI18n.ts';

// Функции, которые вызываются из разметки (onclick="..." в index.html и в HTML-шаблонах модулей).
// Модули ES не создают глобальных имён, поэтому реестр задан явно: всё, чего здесь нет, из разметки не вызвать.
const handlers = {
  getCurrentProject,
  // диалоги и выбор цвета
  closeColorPicker, closeConfirm, closeSummary, openColorPicker, openGlassPicker, pickColor, runConfirm,
  updateColorSwatch, updateGlassSwatch,
  // проекты
  onSearch: projects.onSearch, clearSearch: projects.clearSearch, openProject: projects.openProject,
  openNewProject: projects.openNewProject, closeNewProject: projects.closeNewProject, saveProjectForm: projects.saveProjectForm,
  closeProjectScreen: projects.closeProjectScreen, toggleProjectMenu: projects.toggleProjectMenu, closeProjectMenu: projects.closeProjectMenu,
  startEditProject: projects.startEditProject, copyCurrentProject: projects.copyCurrentProject,
  confirmDeleteCurrentProject: projects.confirmDeleteCurrentProject, openProjectSummary: projects.openProjectSummary,
  shareProjectPdf, addExampleProject,
  // форма и меню элемента
  openElementForm: elementForm.openElementForm, closeElementForm: elementForm.closeElementForm, addElementItem: elementForm.addElementItem,
  toggleSillLenRow: elementForm.toggleSillLenRow, updateSillLenPlaceholder: elementForm.updateSillLenPlaceholder,
  toggleElementMenu: elementForm.toggleElementMenu, closeElementMenu: elementForm.closeElementMenu,
  startEditElement: elementForm.startEditElement, toggleEditSillLenRow: elementForm.toggleEditSillLenRow,
  updateEditSillLenPlaceholder: elementForm.updateEditSillLenPlaceholder, closeEditElement: elementForm.closeEditElement,
  saveEditElement: elementForm.saveEditElement, confirmDeleteCurrentElement: elementForm.confirmDeleteCurrentElement,
  clearCurrentElement: elementForm.clearCurrentElement, copyCurrentElement: elementForm.copyCurrentElement,
  openElementSummary: elementForm.openElementSummary,
  // экран элемента
  openElementView: elementView.openElementView, closeElementView: elementView.closeElementView, stepElement: elementView.stepElement,
  undoElement: elementView.undoElement, redoElement: elementView.redoElement, clearElementScheme: elementView.clearElementScheme,
  selectNode: elementView.selectNode, startToolDrag: elementView.startToolDrag, dimKey: elementView.dimKey,
  editNodeDim: elementView.editNodeDim, editDimension: elementView.editDimension,
  closeDimSheet: elementView.closeDimSheet, saveDimension: elementView.saveDimension,
  // 3D
  open3DView: view3d.open3DView, close3DView: view3d.close3DView, v3dResetView: view3d.v3dResetView, v3dToggle: view3d.v3dToggle,
  // каталог и настройки цветов
  openCatalog: catalog.openCatalog, closeCatalog: catalog.closeCatalog, setCatalogMat: catalog.setCatalogMat, shareCatalog: catalog.shareCatalog,
  catalogAddToProject: catalog.catalogAddToProject, catalogPickProject: catalog.catalogPickProject,
  closeCatalogProjectPicker: catalog.closeCatalogProjectPicker, openColorSetting: catalog.openColorSetting,
  closeColorSetting: catalog.closeColorSetting, setColorSettingMat: catalog.setColorSettingMat, colorSettingToggle: catalog.colorSettingToggle,
  // раскрой
  openCutting: cutting.openCutting, closeCutting: cutting.closeCutting, openCutHelp: cutting.openCutHelp, closeCutHelp: cutting.closeCutHelp,
  openCutProjectPicker: cutting.openCutProjectPicker, closeCutProjectPicker: cutting.closeCutProjectPicker, cutProjectPick: cutting.cutProjectPick,
  cuttingSettingChanged: cutting.cuttingSettingChanged, cuttingRoleUnitChanged: cutting.cuttingRoleUnitChanged,
  cutSelectVariant: cutting.cutSelectVariant, calcCutting: cutting.calcCutting, commitWarehouseUsage: cutting.commitWarehouseUsage,
  saveCuttingScraps: cutting.saveCuttingScraps, shareCuttingPdf: cutting.shareCuttingPdf,
  // склад
  openWarehouse: warehouse.openWarehouse, closeWarehouse: warehouse.closeWarehouse, whSetMat: warehouse.whSetMat,
  whKerfChanged: warehouse.whKerfChanged, openWhAdd: warehouse.openWhAdd, closeWhAdd: warehouse.closeWhAdd,
  saveWhRemnant: warehouse.saveWhRemnant, deleteWhRemnant: warehouse.deleteWhRemnant, openWhSearch: warehouse.openWhSearch,
  closeWhSearch: warehouse.closeWhSearch, runWhSearch: warehouse.runWhSearch, openWhPicker: warehouse.openWhPicker,
  closeWhPicker: warehouse.closeWhPicker, whPickerChoose: warehouse.whPickerChoose, openWhPickProject: warehouse.openWhPickProject,
  closeWhPickProject: warehouse.closeWhPickProject, whPickProjectSelected: warehouse.whPickProjectSelected,
  closeWhPickPiece: warehouse.closeWhPickPiece, whPickPieceSelected: warehouse.whPickPieceSelected,
  // цены
  openPriceEstimate: priceScreens.openPriceEstimate, closePriceEstimate: priceScreens.closePriceEstimate,
  togglePriceDetail: priceScreens.togglePriceDetail, setPriceElementsOpen: priceScreens.setPriceElementsOpen,
  openPriceSetting: priceScreens.openPriceSetting, closePriceSetting: priceScreens.closePriceSetting, savePriceSetting: priceScreens.savePriceSetting,
  // резервная копия
  openExportPicker: backup.openExportPicker, closeExportPicker: backup.closeExportPicker, toggleExportSelect: backup.toggleExportSelect,
  exportPickToggleAll: backup.exportPickToggleAll, confirmExportSelected: backup.confirmExportSelected,
  importProjects: backup.importProjects, importProjectsFromFile: backup.importProjectsFromFile,
  // меню по долгому нажатию
  pcmAction: menus.pcmAction, pcmBackdropClick: menus.pcmBackdropClick, pecmAction: menus.pecmAction, pecmBackdropClick: menus.pecmBackdropClick,
  // стёкла и сетки, язык PDF
  openGlassScreen: glassList.openGlassScreen, closeGlassScreen: glassList.closeGlassScreen,
  glassCutSettingChanged: glassList.glassCutSettingChanged, calcGlassCut: glassList.calcGlassCut, shareGlassPdf: glassList.shareGlassPdf,
  closePdfOptions: pdfI18n.closePdfOptions, confirmPdfOptions: pdfI18n.confirmPdfOptions,
  // навигация, «О приложении», лицензия
  openSettings: navigation.openSettings, closeSettings: navigation.closeSettings,
  openAbout: about.openAbout, closeAbout: about.closeAbout,
  licCopyId: license.licCopyId, licRecheck: license.licRecheck
};
export type Handlers = typeof handlers;
Object.assign(window, handlers);

function init(): void {
  // порядок как в исходной версии: настройки, затем проекты и примеры, затем список
  S.prices = loadPriceSettings();
  S.catalogOff = catalog.loadCatalogOff();
  warehouse.loadWarehouse();
  S.cutting = cutting.loadCuttingSettings();
  loadProjects();
  seedExamplesOnce();
  // просим браузер не чистить данные автоматически
  try{ if(navigator.storage && navigator.storage.persist) void navigator.storage.persist(); }catch{ /* не поддерживается */ }
  projects.render();

  about.initAbout();
  elementView.initElementView();
  catalog.initCatalogLongPress();
  menus.initLongPressMenus();
  navigation.initHardwareBack();
  navigation.initBackGesture();
  navigation.initTabFabHide();
  license.initLicense();
}
init();
