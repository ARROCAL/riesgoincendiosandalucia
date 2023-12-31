///////////////////////////////////////////////////////////////////////////
// Copyright © Esri. All Rights Reserved.
//
// Licensed under the Apache License Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//    http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
///////////////////////////////////////////////////////////////////////////

define([
    'dojo/on',
    'dojo/Evented',
    'dojo/Deferred',
    'dojo/_base/declare',
    'dojo/_base/lang',
    'dojo/_base/array',
    'dojo/_base/html',
    'dojo/_base/query',
    'dojo/_base/Color',
    'dijit/popup',
    'dijit/_WidgetBase',
    'dijit/TooltipDialog',
    'dijit/_TemplatedMixin',
    'dijit/_WidgetsInTemplateMixin',
    'dojo/text!./templates/StatisticsChart.html',
    'esri/lang',
    'esri/graphic',
    'esri/symbols/jsonUtils',
    'esri/layers/FeatureLayer',
    'jimu/utils',
    'jimu/clientStatisticsUtils',
    'jimu/dijit/Chart',
    'jimu/dijit/_StatisticsChartSettings',
    'dojo/keys',
    'dijit/focus',
    'jimu/dijit/LoadingIndicator'
  ],
  function(on, Evented, Deferred, declare, lang, array, html, query, Color, dojoPopup, _WidgetBase, TooltipDialog,
    _TemplatedMixin, _WidgetsInTemplateMixin, template, esriLang, Graphic, symbolJsonUtils, FeatureLayer,
    jimuUtils, clientStatisticsUtils, JimuChart, StatisticsChartSettings, keys, focusUtil) {

    return declare([_WidgetBase, _TemplatedMixin, _WidgetsInTemplateMixin, Evented], {
      baseClass: 'jimu-dijit-statistics-chart',
      templateString: template,
      theme: "light",
      noMoreThanOneChartClassName: 'no-more-than-one-chart',
      hasTitleClassName: 'has-title',
      charts: null,
      paramsDijits: null,
      tooltipDialogs: null,
      currentChartIndex: -1,
      tempGraphics: null,
      maxPreviewFeaturesCount: 20,
      tooltipColor: "green",
      floatNumberFieldDecimalPlace: null,//{fieldName: decimal place,...}
      popupFieldInfosObj: null,//{fieldName:{fieldName,label,isEditable,tooltip,visible,format...}}
      config: null,
      features: null,
      featureLayer: null,

      //options:
      map: null,// if used in setting page, it is null
      fontColor: "#333333",
      isBigPreview: false,
      showSettingIcon: false,
      showZoomIcon: false,//if isBigPreview is true, showZoomIcon will be ignored
      zoomToFeaturesWhenClick: false,
      initialChartIndex: 0,

      //public methods
      //resize
      //createClientCharts
      //clear

      //public events
      //zoomin

      postMixInProperties:function(){
        this.nls = window.jimuNls.statisticsChart;
        lang.mixin(this.nls, window.jimuNls.common);
        this.charts = [];
        this.paramsDijits = [];
        this.tooltipDialogs = [];
        if(this.isBigPreview){
          this.showZoomIcon = false;
        }
      },

      postCreate: function(){
        this.inherited(arguments);

        if(this.showSettingIcon){
          this.own(on(document.body, 'click', lang.hitch(this, this._onDocumentBodyClick)));

          this.own(on(this.settingsIcon, 'keydown', lang.hitch(this, function(event) {
            if (event.keyCode === keys.ENTER) {
              this._onSettingsIconClicked();
            }else if( event.keyCode === keys.TAB && event.shiftKey){
              event.preventDefault();
              focusUtil.focus(this.pagingUl);
            }
          })));
        }else{
          html.destroy(this.settingsIcon);
        }

        if(this.showZoomIcon){
          this.own(on(this.zoominIcon, 'click', lang.hitch(this, function() {
            this.emit("zoomin");
          })));

          this.own(on(this.zoominIcon, 'keydown', lang.hitch(this, function(event) {
            if (event.keyCode === keys.ENTER) {
              this.emit("zoomin");
            }
          })));
        }else{
          html.destroy(this.zoominIcon);
        }

        if(this.isBigPreview){
          this.chartRealContainer.style.maxHeight = "auto";
          html.addClass(this.domNode, 'big-preview');
        }

        this.zoominIcon.title = this.nls.enlarge;
        this.settingsIcon.title = this.nls.setting;

        html.addClass(this.domNode, this.noMoreThanOneChartClassName);
      },

      destroy: function(){
        this.clear();
        this.inherited(arguments);
      },

      resize: function(width, height){
        if(width > 0 || (typeof width === 'string' && width.length > 0)){
          this.domNode.style.width = width;
        }
        if(height > 0 || (typeof height === 'string' && height.length > 0)){
          this.domNode.style.height = height;
        }

        this._resize();
      },

      resizeByParent: function(){
        this.domNode.style.width = "100%";
        this.domNode.style.height = "100%";
        this._resize();
      },

      _resize: function(){
        this._calculateChartBox();

        if(this.currentChartIndex >= 0){
          this._showChart(this.currentChartIndex);
        }
      },

      createServerStatisticsCharts: function(dataSchema, statisticsFeatures, config){
        var originalFieldInfos = dataSchema.fields;
        // var groupByFields = dataSchema.groupByFields;

        var mockDefinition = {
          type: 'Table',
          fields: []//{name,type,alias}
        };

        var mockConfig = lang.clone(config);

        var mode = config.mode;

        if(mode === 'category'){
          /*
          dataSchema: {
            groupByFields: ['POP_CLASS'],
            fields: [{
              name: 'POP',
              type: 'esriFieldTypeInteger',
              alias: 'POP'
            }, {
              name: 'POP_RANK',
              type: 'esriFieldTypeInteger',
              alias: 'POP_RANK'
            }, {
              name: 'POP_CLASS',
              type: 'esriFieldTypeString',
              alias: 'POP_CLASS'
            }]
          }

          config: {
            mode: 'category',
            categoryField: 'POP_CLASS',
            valueFields: ['POP', 'POP_RANK'],
            operation: 'sum'
          }

          mockDefinition: {
            type: 'Table',
            fields: [{
              name: 'POP_CLASS',
              type: 'esriFieldTypeString',
              alias: 'POP_CLASS'
            }, {
              name: 'POP_sum',
              type: 'esriFieldTypeDouble',
              alias: 'POP_sum'
            }, {
              name: 'POP_RANK_sum',
              type: 'esriFieldTypeDouble',
              alias: 'POP_RANK_sum'
            }]
          }

          mockConfig: {
            mode: 'category',
            categoryField: 'POP_CLASS',
            valueFields: ['POP_sum', 'POP_RANK_sum']
          }

          mockFeatures: [{POP_CLASS,POP_sum,POP_RANK_sum},...]
          */
          mockConfig.valueFields = [];

          mockDefinition.fields = array.map(config.valueFields, lang.hitch(this, function(valueField){
            var operation = config.operation;
            if(operation === 'average'){
              operation = 'avg';
            }
            var mockFieldName = valueField + "_" + jimuUtils.upperCaseString(operation);
            var mockFieldAlias = valueField + "_" + jimuUtils.upperCaseString(operation);
            mockConfig.valueFields.push(mockFieldName);
            var mockFieldInfo = {
              name: mockFieldName,
              type: "esriFieldTypeDouble",
              alias: mockFieldAlias
            };
            return mockFieldInfo;
          }));
          array.some(originalFieldInfos, lang.hitch(this, function(originalFieldInfo){
            if(originalFieldInfo.name === config.categoryField){
              mockDefinition.fields.push(originalFieldInfo);
              return true;
            }else{
              return false;
            }
          }));
        }else if(mode === 'count'){
          /*
          dataSchema: {
            groupByFields: ['POP_CLASS'],
            fields: [{
              name: 'POP',
              type: 'esriFieldTypeInteger',
              alias: 'POP'
            }, {
              name: 'POP_RANK',
              type: 'esriFieldTypeInteger',
              alias: 'POP_RANK'
            }, {
              name: 'POP_CLASS',
              type: 'esriFieldTypeString',
              alias: 'POP_CLASS'
            }]
          }

          config: {
            mode: 'count',
            categoryField: 'POP_CLASS'
          }

          mockDefinition: {
            type: 'Table',
            fields: [{
              name: 'POP_CLASS',
              type: 'esriFieldTypeString',
              alias: 'POP_CLASS'
            }, {
              name: 'POP_count',
              type: 'esriFieldTypeInteger',
              alias: 'count'
            }]
          }

          mockConfig: {
            mode: 'feature',
            labelField: 'POP_CLASS',
            valueFields: ['POP_count']
          }

          mockFeatures: [{POP_CLASS,POP_count},...]
          */
          mockConfig.mode = 'feature';
          mockConfig.labelField = config.categoryField;
          var countField = dataSchema.fields[0].name + "_count";
          mockConfig.valueFields = [countField];

          //POP_CLASS
          array.some(originalFieldInfos, lang.hitch(this, function(originalFieldInfo){
            if(originalFieldInfo.name === config.categoryField){
              mockDefinition.fields.push(originalFieldInfo);
              return true;
            }else{
              return false;
            }
          }));
          //POP_count
          mockDefinition.fields.push({
            name: countField,
            type: 'esriFieldTypeInteger',
            alias: this.nls.count
          });
        }else if(mode === 'field'){
          /*
          dataSchema: {
            groupByFields: [],
            fields: [{
              name: 'POP_RANK',
              type: 'esriFieldTypeInteger',
              alias: 'POP_RANK'
            }, {
              name: 'LABEL_FLAG',
              type: 'esriFieldTypeInteger',
              alias: 'LABEL_FLAG'
            }]
          }

          config: {
            mode: 'field',
            valueFields: ['POP_RANK', 'LABEL_FLAG'],
            operation: 'sum'
          }

          mockDefinition: {
            type: 'Table',
            fields: [{
              name: 'POP_sum',
              type: 'esriFieldTypeDouble',//same with original
              alias: 'POP_RANK_sum'
            }, {
              name: 'POP_RANK_sum',
              type: 'esriFieldTypeDouble',//same with original
              alias: 'LABEL_FLAG_sum'
            }]
          }

          mockConfig: {
            mode: 'field',
            valueFields: ['POP_sum', 'POP_RANK_sum'],
            operation: 'sum'
          }

          mockFeatures: [{POP_RANK_sum,LABEL_FLAG_sum}]//only one feature
          */

          mockConfig.valueFields = [];

          mockDefinition.fields = array.map(config.valueFields, lang.hitch(this, function(valueField){
            var operation = config.operation;
            if(operation === 'average'){
              operation = 'avg';
            }
            var mockFieldName = valueField + "_" + jimuUtils.upperCaseString(operation);
            var mockFieldAlias = valueField + "_" + jimuUtils.upperCaseString(operation);
            mockConfig.valueFields.push(mockFieldName);
            var mockFieldInfo = {
              name: mockFieldName,
              type: "esriFieldTypeDouble",
              alias: mockFieldAlias
            };
            return mockFieldInfo;
          }));
        }

        return this._getLoadedLayer(mockDefinition).then(lang.hitch(this, function(mockFeatureLayer){
          var args = {
            featureLayer: mockFeatureLayer,
            features: statisticsFeatures,
            config: mockConfig
          };
          this._createChartsAsync(args);
        }));
      },

      /*
      featureLayerOrUrl: a FeatureLayer instance or FeatureLayer url
      features: feature array
      config:feature mode {
        mode,
        name,
        labelField,
        valueFields,
        sortOrder,
        highLightColor,
        types: [{
          type: 'bar',
          display: {
            backgroundColor,
            colors,
            showLegend,
            legendTextColor,
            showHorizontalAxis,
            horizontalAxisTextColor,
            showVerticalAxis,
            verticalAxisTextColor
          }
        }, {
          type: 'column',
          display: {
            backgroundColor,
            colors,
            showLegend,
            legendTextColor,
            showHorizontalAxis,
            horizontalAxisTextColor,
            showVerticalAxis,
            verticalAxisTextColor
          }
        }, {
          type: 'line',
          display: {
            backgroundColor,
            colors,
            showLegend,
            legendTextColor,
            showHorizontalAxis,
            horizontalAxisTextColor,
            showVerticalAxis,
            verticalAxisTextColor
          }
        }, {
          type: 'pie',
          display: {
            backgroundColor,
            colors,
            showLegend,
            legendTextColor,
            showDataLabel,
            dataLabelColor
          }
        }]
      }
      config: category mode {
        mode,
        name,
        categoryField,
        operation,
        valueFields,
        sortOrder,
        highLightColor,
        types
      }
      config: count mode {
        mode,
        name,
        categoryField,
        sortOrder,
        highLightColor,
        types
      }
      config: field mode {
        mode,
        name,
        operation,
        valueFields,
        sortOrder,
        highLightColor,
        types
      }
      */
      createClientCharts: function(featureLayerOrUrlOrLayerDefinition, features, config,
        popupFieldInfosObj, featureLayerForChartSymbologyChart){
        if(featureLayerForChartSymbologyChart){
          this.featureLayerForChartSymbologyChart = featureLayerForChartSymbologyChart;
        }
        return this._getLoadedLayer(featureLayerOrUrlOrLayerDefinition).then(lang.hitch(this, function(featureLayer){
          var args = {
            featureLayer: featureLayer,
            features: features,
            config: config,
            popupFieldInfosObj:popupFieldInfosObj
          };
          this._createChartsAsync(args);
        }));
      },

      _getLoadedLayer: function(featureLayerOrUrlOrLayerDefinition){
        var def = new Deferred();
        var featureLayer = null;
        if(typeof featureLayerOrUrlOrLayerDefinition === 'string'){
          //url
          featureLayer = new FeatureLayer(featureLayerOrUrlOrLayerDefinition);
        }else{
          if(featureLayerOrUrlOrLayerDefinition.declaredClass === "esri.layers.FeatureLayer"){
            //FeatureLayer
            featureLayer = featureLayerOrUrlOrLayerDefinition;
          }else{
            //layerDefinition
            featureLayer = new FeatureLayer({
              layerDefinition: lang.clone(featureLayerOrUrlOrLayerDefinition),
              featureSet: null
            });
          }
        }

        if (featureLayer.loaded) {
          def.resolve(featureLayer);
        } else {
          this.own(on(featureLayer, 'load', lang.hitch(this, function() {
            def.resolve(featureLayer);
          })));
        }

        return def;
      },

      _createChartsAsync: function(args){
        setTimeout(lang.hitch(this, function(){
          this._createCharts(args);
        }), 0);
      },

      //args: {featureLayer,features,config}
      _createCharts: function(args) {
        try{
			
		  //inicio aac
		  html.setStyle(this.settingsIcon, 'display', 'none');
          //fin aac
		  this.loading.hide();

          this.clear();
          var isSelectedFeatures = false;
          if(args.features){
            isSelectedFeatures = !!args.features.isSelectedFeatures;
            args.features = array.filter(args.features, lang.hitch(this, function(feature){
              return !!feature.attributes;
            }));
          }
          this.config = args.config;
          this.features = args.features;

          this.featureLayer = args.featureLayer;
          //set popupFieldInfosObj
          if(args.popupFieldInfosObj){
            this.popupFieldInfosObj = args.popupFieldInfosObj;
          }else{
            this.popupFieldInfosObj = {};
          }

          if(!this.config.highLightColor){
            if(isSelectedFeatures){
              //set red color for selected features
              this.config.highLightColor = "#ff0000";
            }else{
              //set selection like symbol
              this.config.highLightColor = "#00ffff";
            }
          }
          // this._updatePopupFieldInfos();
          this._calculateDecimalPlaceForFloatField();

          this.chartTitle.innerHTML = jimuUtils.stripHTML(this.config.name || "");
          this.chartTitle.title = this.chartTitle.innerHTML;

          if(this.chartTitle.title){
            html.addClass(this.domNode, this.hasTitleClassName);
          }else{
            html.removeClass(this.domNode, this.hasTitleClassName);
          }

          //description
          if(this.config.description){
            html.setStyle(this.descriptionContainer, 'display', 'block');
            var description = jimuUtils.stripHTML(this.config.description);
            this.descriptionContainer.innerHTML = description;
            this.descriptionContainer.title = description;
          }else{
            this.descriptionContainer.innerHTML = "";
            this.descriptionContainer.title = "";
            html.setStyle(this.descriptionContainer, 'display', 'none');
          }

          if(args.config.types.length <= 1){
            html.addClass(this.domNode, this.noMoreThanOneChartClassName);
          }else{
            html.removeClass(this.domNode, this.noMoreThanOneChartClassName);
          }

          var box = this._calculateChartBox();
          var w = box.w + 'px';
          var h = box.h + 'px';
          var types = (args.config && args.config.types) || [];
          var chartTypeString = {};
          types.forEach(function(typeInfo) {
            var type = typeInfo && typeInfo.type;
            if (!type) {
              return;
            }
            if (type === "column") {
              chartTypeString.column = this.nls.columnChart;
            } else if (type === "bar") {
              chartTypeString.bar = this.nls.barChart;
            } else if (type === "line") {
              chartTypeString.line = this.nls.lineChart;
            } else if (type === "pie") {
              chartTypeString.pie = this.nls.pieChart;
            }
          }.bind(this));

          var chartDivs = array.map(args.config.types, lang.hitch(this, function(typeInfo){
            var chartDiv = html.create('div', {
              'class': 'chart-div',
              style: {
                width: w,
                height: h
              }
            }, this.chartRealContainer);

            var type = typeInfo.type;
            // chartDivs.push(chartDiv);
            var strLi = "<li class='paging-li'><a tabindex='0' role='link' aria-label='" + chartTypeString[type] +
            "'class='paging-a'></a></li>";

            var domLi = html.toDom(strLi);
            html.place(domLi, this.pagingUl);


            var displayConfig = typeInfo.display;
            if(!displayConfig.backgroundColor){
              displayConfig.backgroundColor = "transparent";//'#ffffff';
            }
            if(!displayConfig.hasOwnProperty("showLegend")){
              displayConfig.showLegend = false;
            }
            if(!displayConfig.legendTextColor){
              displayConfig.legendTextColor = this.fontColor;
            }
            if(type === 'pie'){
              if(!displayConfig.hasOwnProperty("showDataLabel")){
                displayConfig.showDataLabel = true;
              }
              if(!displayConfig.dataLabelColor){
                displayConfig.dataLabelColor = this.fontColor;
              }
            }else{
              if(!displayConfig.hasOwnProperty("showHorizontalAxis")){
                displayConfig.showHorizontalAxis = true;
              }
              if(!displayConfig.horizontalAxisTextColor){
                displayConfig.horizontalAxisTextColor = this.fontColor;
              }
              if(!displayConfig.hasOwnProperty("showVerticalAxis")){
                displayConfig.showVerticalAxis = true;
              }
              if(!displayConfig.verticalAxisTextColor){
                displayConfig.verticalAxisTextColor = this.fontColor;
              }
            }

            return chartDiv;
          }));

          var createResult = null;//{charts:[],paramsDijits:[]}

          if(this.config.mode === 'feature'){
            createResult = this._createFeatureModeCharts(args, chartDivs);
          }else if(this.config.mode === 'category'){
            createResult = this._createCategoryModeCharts(args, chartDivs);
          }else if(this.config.mode === 'count'){
            createResult = this._createCountModeCharts(args, chartDivs);
          }else if(this.config.mode === 'field'){
            createResult = this._createFieldModeCharts(args, chartDivs);
          }

          this.charts = createResult.charts;
          this.paramsDijits = createResult.paramsDijits;
          this.tooltipDialogs = array.map(this.paramsDijits, lang.hitch(this, function(paramsDijit){
            var ttdContent = html.create('div');
            paramsDijit.placeAt(ttdContent);
            var tooltipDialog = new TooltipDialog({
              content: ttdContent
            });
            return tooltipDialog;
          }));
          var chartIndex = 0;
          if(this.initialChartIndex >= 0){
            if(this.charts.length >= (this.initialChartIndex + 1)){
              chartIndex = this.initialChartIndex;
            }
          }
          this._showChart(chartIndex);
        }catch(e){
          console.error(e);
        }
      },

      _calculateChartBox: function(){
        var hasDesc = !!this.config.description;
        var thisBox = html.getContentBox(this.domNode);
        var height = thisBox.h;
        var itemHeight = height;

        if(this.resultsHeader.clientHeight > 0){
          var headerBox = html.getMarginBox(this.resultsHeader);
          itemHeight = height - headerBox.h;
        }

        var descriptionHeight = 0;
        if(hasDesc){
          descriptionHeight = parseInt(height * 0.15, 10);
          itemHeight = itemHeight - descriptionHeight;
        }

        var arrowHeight = 60;
        if(itemHeight < arrowHeight){
          arrowHeight = itemHeight;
        }
        html.setStyle(this.leftArrow, 'height', arrowHeight + 'px');
        html.setStyle(this.rightArrow, 'height', arrowHeight + 'px');
        html.setStyle(this.chartRealContainer, 'height', itemHeight + 'px');
        html.setStyle(this.descriptionContainer, 'max-height', descriptionHeight + 'px');
        //set the height of fiald-render-info
        html.setStyle(this.faildRenderInfo, 'height', itemHeight + 'px');
        var box = html.getContentBox(this.chartRealContainer);
        return box;
      },

      // _updatePopupFieldInfos: function(){
      //   this.popupFieldInfosObj = {};
      //   var fieldInfosInMapViewer = null;

      //   if(this.config.url && this.map && this.map.itemInfo && this.map.itemInfo.itemData){
      //     var configUrl = jimuUtils.removeSuffixSlashes(this.config.url);
      //     configUrl = portalUrlUtils.removeProtocol(configUrl);
      //     var operationalLayers = this.map.itemInfo.itemData.operationalLayers;
      //     var splits = configUrl.split("/");
      //     var strLayerId = splits[splits.length - 1];
      //     var layerId = parseInt(strLayerId, 10);

      //     if(operationalLayers && operationalLayers.length > 0){
      //       array.some(operationalLayers, lang.hitch(this, function(operationalLayer){
      //         var layerUrl = operationalLayer.url;
      //         if(layerUrl){
      //           layerUrl = jimuUtils.removeSuffixSlashes(layerUrl);
      //           layerUrl = portalUrlUtils.removeProtocol(layerUrl);
      //           if(configUrl.indexOf(layerUrl) >= 0){
      //             if(configUrl === layerUrl){
      //               //operationalLayer is a feature layer
      //               if(operationalLayer.popupInfo && operationalLayer.popupInfo.fieldInfos){
      //                 fieldInfosInMapViewer = operationalLayer.popupInfo.fieldInfos;
      //                 return true;
      //               }
      //             }else if(configUrl.length > layerUrl.length){
      //               //operationalLayer is a map server or group layer
      //               if(operationalLayer.layers && layerId >= 0){
      //                 var subOperationLayer = operationalLayer[layerId];
      //                 if(subOperationLayer && subOperationLayer.popupInfo &&
      //                   subOperationLayer.popupInfo.fieldInfos){
      //                   fieldInfosInMapViewer = subOperationLayer.popupInfo.fieldInfos;
      //                   return true;
      //                 }
      //               }
      //             }
      //           }
      //         }
      //         return false;
      //       }));
      //     }
      //   }

      //   if(fieldInfosInMapViewer && fieldInfosInMapViewer.length > 0){
      //     array.forEach(fieldInfosInMapViewer, lang.hitch(this, function(fieldInfo){
      //       var fieldName = fieldInfo.fieldName;
      //       this.popupFieldInfosObj[fieldName] = fieldInfo;
      //     }));
      //   }
      // },

      _calculateDecimalPlaceForFloatField: function(){
        this.floatNumberFieldDecimalPlace = {};//{fieldName: decimal place,...}
        var fieldNames = [];
        if(this.config.labelField){
          fieldNames.push(this.config.labelField);
        }
        if(this.config.categoryField){
          fieldNames.push(this.config.categoryField);
        }
        if(this.config.valueFields){
          fieldNames = fieldNames.concat(this.config.valueFields);
        }
        var floatNumberFields = array.filter(fieldNames, lang.hitch(this, function(fieldName){
          return this._isFloatNumberField(fieldName);
        }));
        //{field:values, ...} like {POP: [1,2,3],...}
        var floatNumberFieldValues = {};
        array.forEach(floatNumberFields, lang.hitch(this, function(fieldName){
          floatNumberFieldValues[fieldName] = [];
        }));
        var features = this.features;
        if(features && features.length > 0){
          array.forEach(features, lang.hitch(this, function(feature){
            var attributes = feature.attributes;
            if(attributes){
              array.forEach(floatNumberFields, lang.hitch(this, function(fieldName){
                var value = attributes[fieldName];
                if(typeof value === 'number'){
                  floatNumberFieldValues[fieldName].push(value);
                }
              }));
            }
          }));
        }
        array.forEach(floatNumberFields, lang.hitch(this, function(fieldName){
          this.floatNumberFieldDecimalPlace[fieldName] = 0;
          var values = floatNumberFieldValues[fieldName];
          if(values.length > 0){
            try{
              var decimalPlace = this._getBestDecimalPlace(values);
              this.floatNumberFieldDecimalPlace[fieldName] = decimalPlace;
            }catch(e){
              this.floatNumberFieldDecimalPlace[fieldName] = 0;
              console.error(e);
            }
          }
          //use popup field info to override the calculated places
          if(this.popupFieldInfosObj){
            var popupFieldInfo = this.popupFieldInfosObj[fieldName];
            if(popupFieldInfo){
              if(popupFieldInfo.format && popupFieldInfo.format.places >= 0){
                this.floatNumberFieldDecimalPlace[fieldName] = popupFieldInfo.format.places;
              }
            }
          }
        }));
      },

      _onDocumentBodyClick: function(event){
        if(this.currentChartIndex >= 0 && this.tooltipDialogs){
          var tooltipDialog = this.tooltipDialogs[this.currentChartIndex];
          if(tooltipDialog){
            var originalOpenStatus = !!tooltipDialog.isOpendNow;
            this._hideAllTooltipDialogs();
            var target = event.target || event.srcElement;
            if(target === this.leftArrow || target === this.rightArrow){
              return;
            }
            if(html.hasClass(target, 'paging-a') || html.hasClass(target, 'paging-li')){
              return;
            }
            var isClickSettingIcon = target === this.settingsIcon;
            if(isClickSettingIcon){
              if(originalOpenStatus){
                this._hideTooltipDialog(tooltipDialog);
              }
              else{
                this._showTooltipDialog(tooltipDialog);
              }
            }else{
              var a = target === tooltipDialog.domNode;
              var b = html.isDescendant(target, tooltipDialog.domNode);
              var isClickInternal = a || b;
              if(isClickInternal){
                if(originalOpenStatus){
                  this._showTooltipDialog(tooltipDialog);
                }else{
                  this._hideTooltipDialog(tooltipDialog);
                }
              }else{
                this._hideTooltipDialog(tooltipDialog);
              }
            }
          }else{
            this._hideAllTooltipDialogs();
          }
        }else{
          this._hideAllTooltipDialogs();
        }
      },

      _onSettingsIconClicked: function(){
        var tooltipDialog = this.tooltipDialogs[this.currentChartIndex];
        if(!tooltipDialog){
          return;
        }
        var originalOpenStatus = !!tooltipDialog.isOpendNow;
        if (originalOpenStatus) {
          this._hideTooltipDialog(tooltipDialog);
          focusUtil.focus(this.settingsIcon);
        }else {
          this._showTooltipDialog(tooltipDialog);
          var paramsDijit = this.paramsDijits[this.currentChartIndex];
          if(!paramsDijit){
            return;
          }
          focusUtil.focus(paramsDijit.domNode);
        }
      },

      clear: function(){
        this.config = null;
        this.features = null;
        this.featureLayer = null;
        this.chartTitle.innerHTML = "";
        this.chartTitle.title = "";

        this.currentChartIndex = -1;
        this.floatNumberFieldDecimalPlace = null;
        this.popupFieldInfosObj = null;
        query("li", this.pagingUl).removeClass('selected');

        if(!this.charts){
          this.charts = [];
        }

        if(!this.paramsDijits){
          this.paramsDijits = [];
        }

        if(!this.tooltipDialogs){
          this.tooltipDialogs = [];
        }

        for(var i = 0; i < this.charts.length; i++){
          //destroy chart
          if(this.charts[i]){
            this.charts[i].destroy();
          }
          this.charts[i] = null;

          //destroy paramsDijit
          if(this.paramsDijits[i]){
            this.paramsDijits[i].destroy();
          }
          this.paramsDijits[i] = null;

          //destroy tooltipDialog
          if(this.tooltipDialogs[i]){
            this.tooltipDialogs[i].destroy();
          }
          this.tooltipDialogs[i] = null;
        }
        this.charts = [];
        this.paramsDijits = [];
        this.tooltipDialogs = [];
        html.empty(this.pagingUl);
        html.empty(this.chartRealContainer);
        html.empty(this.descriptionContainer);
        html.addClass(this.domNode, this.noMoreThanOneChartClassName);
      },

      _showFialdRenderInfo:function(){
        html.addClass(this.chartSection, 'render-faild');
      },

      _hideFialdRenderInfo:function(){
        html.removeClass(this.chartSection, 'render-faild');
      },

      _showChart: function(index) {
        this.currentChartIndex = -1;
        var chartDivs = query('.chart-div', this.chartRealContainer);
        chartDivs.style({
          display: 'none'
        });
        var lis = query("li", this.pagingUl);
        lis.removeClass('selected');

        if (index < 0) {
          return;
        }

        var chartDiv = chartDivs[index];
        if (chartDiv) {
          this.currentChartIndex = index;
          html.setStyle(chartDiv, 'display', 'block');
        }

        var li = lis[index];
        if (li) {
          html.addClass(li, 'selected');
        }

        if (this.charts && this.charts.length > 0) {
          chart = this.charts[index];
          if (chart) {
            //hide pie chart when labels > 150, show render pie chart faild
            this._handlePieChartDisplay(chart);
          }
        }

        if(this.isBigPreview){
          return;
        }

        var chart = null;
        if(this.charts && this.charts.length > 0){
          chart = this.charts[index];
          if(chart){
            var chartBox = this._calculateChartBox();
            var currentChartBox = html.getContentBox(chartDiv);
            if(chartBox.w !== currentChartBox.w || chartBox.h !== currentChartBox.h){
              this.loading.show();
              //size changes
              var w = chartBox.w + 'px';
              var h = chartBox.h + 'px';
              html.setStyle(chartDiv, 'width', w);
              html.setStyle(chartDiv, 'height', h);
              chart.resize(w, h);
              this.loading.hide();
            }
          }
        }
      },

      _handlePieChartDisplay: function(chart) {
        var hidePieChart = false;
        if(chart &&  chart.config && chart.config.type === 'pie'){
          var labels = chart.config.labels;
          if(labels && labels.length > 150){
            hidePieChart = true;
          }
        }
        if(hidePieChart){
          this._showFialdRenderInfo();
        }else{
          this._hideFialdRenderInfo();
        }
      },

      _hideAllTooltipDialogs: function(){
        if(this.tooltipDialogs && this.tooltipDialogs.length > 0){
          array.forEach(this.tooltipDialogs, lang.hitch(this, function(tooltipDialog){
            this._hideTooltipDialog(tooltipDialog);
          }));
        }
      },

      _hideTooltipDialog: function(tooltipDialog){
        if(tooltipDialog){
          dojoPopup.close(tooltipDialog);
          tooltipDialog.isOpendNow = false;
        }
      },

      _showTooltipDialog: function(tooltipDialog) {
        if(tooltipDialog){
          dojoPopup.open({
            popup: tooltipDialog,
            around: this.settingsIcon
          });
          tooltipDialog.isOpendNow = true;
        }
      },

      _onPagingUlKeydown: function(event){
        if (event.keyCode === keys.TAB && !event.shiftKey) {
          event.preventDefault();
          focusUtil.focus(this.settingsIcon);
        }

        if (event.keyCode === keys.RIGHT_ARROW || event.keyCode === keys.DOWN_ARROW) {
          this._onRightArrowClicked(event);
          this._focusPagingLink();
        }
        if (event.keyCode === keys.LEFT_ARROW || event.keyCode === keys.UP_ARROW) {
          this._onLeftArrowClicked(event);
          this._focusPagingLink();
        }
      },

      _focusPagingLink: function() {
        var li = query('.paging-li:nth-child(' + (this.currentChartIndex + 1) + ')', this.pagingUl)[0];
        var a = li && li.firstChild;
        if(a){
          focusUtil.focus(a);
        }
      },

      _onPagingUlClicked: function(event){
        event.stopPropagation();
        this._hideAllTooltipDialogs();
        var target = event.target || event.srcElement;
        var tagName = target.tagName.toLowerCase();
        if (tagName === 'a') {
          var as = query('a', this.pagingUl);
          var index = array.indexOf(as, target);
          if (index >= 0) {
            this._showChart(index);
          }
        }
      },

      _onLeftArrowClicked: function(event){
        event.stopPropagation();
        this._hideAllTooltipDialogs();
        var index = (this.currentChartIndex - 1 + this.charts.length) % this.charts.length;
        if (index >= 0) {
          this._showChart(index);
        }
      },

      _onLeftArrowKeydown: function(event) {
        if (event.keyCode === keys.ENTER) {
          this._onLeftArrowClicked(event);
        }
      },

      _onRightArrowClicked: function(event){
        event.stopPropagation();
        this._hideAllTooltipDialogs();
        var index = (this.currentChartIndex + 1 + this.charts.length) % this.charts.length;
        if (index >= 0) {
          this._showChart(index);
        }
      },

      _onRightArrowKeydown: function(event) {
        if (event.keyCode === keys.ENTER) {
          this._onRightArrowClicked(event);
        }
      },

      _getHighLightMarkerSymbol:function(){
        // var sym = symbolJsonUtils.fromJson(this.config.symbol);
        // var size = Math.max(sym.size || 0, sym.width || 0, sym.height, 18);
        // size += 1;

        var size = 30;

        var symJson = {
          "color": [255, 255, 255, 0],
          "size": 18,
          "angle": 0,
          "xoffset": 0,
          "yoffset": 0,
          "type": "esriSMS",
          "style": "esriSMSSquare",
          "outline": {
            "color": [0, 0, 128, 255],
            "width": 0.75,
            "type": "esriSLS",
            "style": "esriSLSSolid"
          }
        };
        var symbol = symbolJsonUtils.fromJson(symJson);
        symbol.setSize(size);
        symbol.outline.setColor(new Color(this.config.highLightColor));

        return symbol;
      },

      _getHighLightLineSymbol: function(/*optional*/ highLightColor){
        var selectedSymJson = {
          "color": [0, 255, 255, 255],
          "width": 1.5,
          "type": "esriSLS",
          "style": "esriSLSSolid"
        };
        var symbol = symbolJsonUtils.fromJson(selectedSymJson);
        symbol.setColor(new Color(highLightColor || this.config.highLightColor));
        return symbol;
      },

      _getDefaultHighLightFillSymbol:function(){
        var symbolJson = {
          "color": [0, 255, 255, 128],
          "outline": {
            "color": [0, 255, 255, 255],
            "width": 1.5,
            "type": "esriSLS",
            "style": "esriSLSSolid"
          },
          "type": "esriSFS",
          "style": "esriSFSSolid"
        };
        var symbol = symbolJsonUtils.fromJson(symbolJson);
        symbol.outline.setColor(new Color(this.config.highLightColor));
        return symbol;
      },

      _getVisualVariableByType: function(type, visualVariables) {
        // we could also use esri.renderer.Renderer.getVisualVariablesForType for renderers
        if (visualVariables) {
          var visVars = array.filter(visualVariables, function(visVar) {
            return (visVar.type === type && !visVar.target);
          });
          if (visVars.length) {
            return visVars[0];
          } else {
            return null;
          }
        }
        return null;
      },

      _getSymbolByRenderer: function(renderer, feature) {
        var symbol = this._getDefaultHighLightFillSymbol();
        var visualVariables = renderer.visualVariables;
        var visVar = this._getVisualVariableByType('colorInfo', visualVariables);
        if (visVar) {
          var color = renderer.getColor(feature, {
            colorInfo: visVar
          });
          if (color) {
            color = lang.clone(color);
            symbol.setColor(color);
          }
        } else {
          symbol = renderer.getSymbol(feature);
        }
        return symbol;
      },

      _getHighLightFillSymbol: function(featureLayer, feature, isSelectedFeature){
        var highLightSymbol = null;
        var currentSymbol = feature.symbol;
        var renderer = featureLayer.renderer;
        if(!currentSymbol && renderer){
          currentSymbol = this._getSymbolByRenderer(renderer, feature);
        }
        if(currentSymbol && typeof currentSymbol.setOutline === 'function'){
          highLightSymbol = symbolJsonUtils.fromJson(currentSymbol.toJson());
          var outlineWidth = 1.5;
          if(currentSymbol.outline){
            if(currentSymbol.outline.width > 0){
              outlineWidth = currentSymbol.outline.width + 1;
            }
          }
          //if feature in feature selection, set red color for selected features
          //if feature is not in feature selection, set selection like symbol
          var highLightColor = isSelectedFeature ? "#ff0000" : this.config.highLightColor;
          var outline = this._getHighLightLineSymbol(highLightColor);
          outline.setWidth(outlineWidth);
          highLightSymbol.setOutline(outline);
        }else{
          highLightSymbol = this._getDefaultHighLightFillSymbol();
        }
        return highLightSymbol;
      },

      _zoomToGraphics: function(features){
        if(!this.map){
          return;
        }

        var isVisible = this.featureLayer && this.featureLayer.visible;
        if(!isVisible){
          return;
        }
        var fs;
        //some graphics maybe don't have geometry or have a invaild geometry,
        //so need to filter graphics here by geometry
        if(features && features.length > 0){
          fs = array.filter(features, function(f) {
            var geometry = f.geometry;
            //if geometry.type is not point, return true
            if (geometry.type !== 'point') {
              return true;
            } else {
              return jimuUtils.isVaildPointGeometry(geometry);
            }
          }.bind(this));
        }

        if(fs && fs.length > 0){
          var featureSet = jimuUtils.toFeatureSet(fs);
          try{
            jimuUtils.zoomToFeatureSet(this.map, featureSet);
          }catch(e){
            console.error(e);
          }
        }
      },

      _removeTempGraphics: function(){
        if(this.featureLayer && this.tempGraphics && this.tempGraphics.length > 0){
          while(this.tempGraphics.length > 0){
            this.featureLayer.remove(this.tempGraphics[0]);
            this.tempGraphics.splice(0, 1);
          }
        }
        this.tempGraphics = null;
      },

      _mouseOverChartItem: function(features){
        this._removeTempGraphics();

        //We need to store the original feature symbol because we will use it in mouse out event.
        array.forEach(features, lang.hitch(this, function(feature) {
          feature._originalSymbol = feature.symbol;
        }));

        var isVisible = this.featureLayer && this.featureLayer.getMap() && this.featureLayer.visible;
        if(!isVisible){
          return;
        }

        var geoType = jimuUtils.getTypeByGeometryType(this.featureLayer.geometryType);
        var symbol = null;
        if(geoType === 'point'){
          symbol = this._getHighLightMarkerSymbol();
          this.tempGraphics = [];
          array.forEach(features, lang.hitch(this, function(feature){
            var g = new Graphic(feature.geometry, symbol);
            this.tempGraphics.push(g);
            this.featureLayer.add(g);
          }));
        }else if(geoType === 'polyline'){
          symbol = this._getHighLightLineSymbol();

          array.forEach(features, lang.hitch(this, function(feature) {
            feature.setSymbol(symbol);
          }));
        }else if(geoType === 'polygon'){

          var selectedFeatures = this.featureLayer.getSelectedFeatures() || [];

          array.forEach(features, lang.hitch(this, function(feature) {
            var isSelectedFeature = selectedFeatures.indexOf(feature) >= 0;
            var highLightSymbol = this._getHighLightFillSymbol(this.featureLayer, feature, isSelectedFeature);
            feature.setSymbol(highLightSymbol);
          }));

          //The outline of these features maybe overlapped by others,
          //so we need to put these features at the end of the featureLayer
          if(this.features.length !== features.length && geoType === 'polygon'){
            array.forEach(features, lang.hitch(this, function(feature){
              this.featureLayer.remove(feature);
            }));
            array.forEach(features, lang.hitch(this, function(feature){
              this.featureLayer.add(feature);
            }));
          }
        }
      },

      _mouseOutChartItem: function(features){
        this._removeTempGraphics();

        // if(!this.featureLayer){
        //   return;
        // }

        //Restore feature's original symbol.
        array.forEach(features, lang.hitch(this, function(feature){
          var _originalSymbol = feature._originalSymbol || null;
          feature.setSymbol(_originalSymbol);
        }));
      },

      _isNumber: function(value){
        var valueType = Object.prototype.toString.call(value).toLowerCase();
        return valueType === "[object number]";
      },

      _tryLocaleNumber: function(value, /*optional*/ fieldName){
        var result = value;
        if(esriLang.isDefined(value) && isFinite(value)){
          try{
            var a;
            //if pass "abc" into localizeNumber, it will return null
            if(fieldName && this._isNumberField(fieldName)){
              var popupFieldInfo = this.popupFieldInfosObj[fieldName];
              if(popupFieldInfo && lang.exists('format.places', popupFieldInfo)){
                a = jimuUtils.localizeNumberByFieldInfo(value, popupFieldInfo);
              }else{
                a = jimuUtils.localizeNumber(value);
              }
            }else{
              //#6117
              a = value; //jimuUtils.localizeNumber(value);
            }

            if(typeof a === "string"){
              result = a;
            }
          }catch(e){
            console.error(e);
          }
        }
        //make sure the retun value is string
        result += "";
        return result;
      },

      _getBestDisplayValue: function(fieldName, value){
        var displayValue = this._tryLocaleNumber(value, fieldName);

        //check subtype description
        //http://services1.arcgis.com/oC086ufSSQ6Avnw2/arcgis/rest/services/Parcels/FeatureServer/0
        if(this.featureLayer.typeIdField === fieldName){
          var types = this.featureLayer.types;
          if(types && types.length > 0){
            var typeObjs = array.filter(types, lang.hitch(this, function(item){
              return item.id === value;
            }));
            if(typeObjs.length > 0){
              displayValue = typeObjs[0].name;
              return displayValue;
            }
          }
        }

        //check codedValue
        //http://jonq/arcgis/rest/services/BugFolder/BUG_000087622_CodedValue/FeatureServer/0
        //http://services1.arcgis.com/oC086ufSSQ6Avnw2/arcgis/rest/services/Parcels/FeatureServer/0
        var fieldInfo = this._getFieldInfo(fieldName);
        if(fieldInfo){
          if(fieldInfo.domain){
            var codedValues = fieldInfo.domain.codedValues;
            if(codedValues && codedValues.length > 0){
              array.some(codedValues, function(item){
                if(item.code === value){
                  displayValue = item.name;
                  return true;
                }else{
                  return false;
                }
              });
            }
          }
        }
        return displayValue;
      },

      _getFieldAliasArray: function(fieldNames){
        var results = array.map(fieldNames, lang.hitch(this, function(fieldName){
          return this._getFieldAlias(fieldName);
        }));
        return results;
      },

      _getFieldAlias: function(fieldName){
        var fieldAlias = fieldName;
        var fieldInfo = this._getFieldInfo(fieldName);
        if(fieldInfo){
          fieldAlias = fieldInfo.alias || fieldAlias;
        }
        return fieldAlias;
      },

      _getFieldInfo: function(fieldName){
        if(this.featureLayer){
          var fieldInfos = this.featureLayer.fields;
          for(var i = 0; i < fieldInfos.length; i++){
            if(fieldInfos[i].name === fieldName){
              return fieldInfos[i];
            }
          }
        }
        return null;
      },

      _isNumberField: function(fieldName){
        var numberTypes = ['esriFieldTypeSmallInteger',
                        'esriFieldTypeInteger',
                        'esriFieldTypeSingle',
                        'esriFieldTypeDouble'];
        var isNumber = array.some(this.featureLayer.fields, lang.hitch(this, function(fieldInfo){
          return fieldInfo.name === fieldName && numberTypes.indexOf(fieldInfo.type) >= 0;
        }));
        return isNumber;
      },

      _isFloatNumberField: function(fieldName){
        var numberTypes = ['esriFieldTypeSingle', 'esriFieldTypeDouble'];
        var isNumber = array.some(this.featureLayer.fields, lang.hitch(this, function(fieldInfo){
          return fieldInfo.name === fieldName && numberTypes.indexOf(fieldInfo.type) >= 0;
        }));
        return isNumber;
      },

      _isDateField: function(fieldName){
        var fieldInfo = this._getFieldInfo(fieldName);
        if(fieldInfo){
          return fieldInfo.type === 'esriFieldTypeDate';
        }
        return false;
      },

      _getBestDecimalPlace: function(floatValues){
        var decimalPlace = 0;
        //{decimal:count,...} like {2:123, 3:321, ...}
        var statisticsHash = {};
        array.forEach(floatValues, function(value){
          var splits = value.toString().split(".");
          var key = null;
          if(splits.length === 1){
            //value doesn't have fractional part
            key = 0;
          }else if(splits.length === 2){
            //value has fractional part
            key = splits[1].length;
          }
          if(key !== null){
            if(statisticsHash[key] === undefined){
              statisticsHash[key] = 1;
            }else{
              statisticsHash[key] += 1;
            }
          }
        });
        var maxDecimalPlaceItem = null;
        for(var key in statisticsHash){
          key = parseInt(key, 10);
          var value = statisticsHash[key];
          if(maxDecimalPlaceItem){
            if(value > maxDecimalPlaceItem.value){
              maxDecimalPlaceItem = {
                key: key,
                value: value
              };
            }
          }else{
            maxDecimalPlaceItem = {
              key: key,
              value: value
            };
          }
        }
        if(maxDecimalPlaceItem){
          decimalPlace = parseInt(maxDecimalPlaceItem.key, 10);
        }
        return decimalPlace;
      },

      _getFloatNumberFieldDecimalPlace: function(floatNumberField){
        var decimalPlace = 0;
        if(this.floatNumberFieldDecimalPlace){
          var value = this.floatNumberFieldDecimalPlace[floatNumberField];
          if(typeof value === 'number'){
            decimalPlace = value;
          }
        }
        return decimalPlace;
      },

      _getBestValueForFloatNumberField: function(value, floatNumberField){
        var decimalPlace = this._getFloatNumberFieldDecimalPlace(floatNumberField);
        var str = value.toFixed(decimalPlace);
        return parseFloat(str);
      },

      _getColors: function(paramsConfig, count){
        var colors = [];
        var config = lang.clone(paramsConfig);

        if(config.colors.length === 2){
          //gradient colors
          colors = this._createGradientColors(config.colors[0],
                                              config.colors[config.colors.length - 1],
                                              count);
        }else{
          var a = Math.ceil(count / config.colors.length);
          for(var i = 0; i < a; i++){
            colors = colors.concat(config.colors);
          }
          colors = colors.slice(0, count);
        }

        return colors;
      },

      _createGradientColors: function(firstColor, lastColor, count){
        var colors = [];
        var c1 = new Color(firstColor);
        var c2 = new Color(lastColor);
        var deltaR = (c2.r - c1.r) / count;
        var deltaG = (c2.g - c1.g) / count;
        var deltaB = (c2.b - c1.b) / count;
        var c = new Color();
        var r = 0;
        var g = 0;
        var b = 0;
        for(var i = 0; i < count; i++){
          r = parseInt(c1.r + deltaR * i, 10);
          g = parseInt(c1.g + deltaG * i, 10);
          b = parseInt(c1.b + deltaB * i, 10);
          c.setColor([r, g, b]);
          colors.push(c.toHex());
        }
        return colors;
      },

      _createParamsDijit: function(type, chartDisplayConfig, mode){
        var options = {
          isInWidget: this.map ? true : false,
          type: type,
          config: chartDisplayConfig
        };
        var paramsDijit = new StatisticsChartSettings(options);

        this.own(on(paramsDijit.domNode, 'keydown', lang.hitch(this, function(event) {
          if(event.keyCode === keys.ESCAPE){
            this._onSettingsIconClicked();
          }
        })));
        paramsDijit._updateLegendDisplayByMode(mode);
        return paramsDijit;
      },

      _createJimuChart: function(chartDiv, mode, options, data, chartTypeInfo){
        var type = chartTypeInfo.type;
        var displayConfig = chartTypeInfo.display;
        var paramsDijit = this._createParamsDijit(type, displayConfig, mode);
        var paramsConfig1 = paramsDijit.getConfig();
        if(paramsConfig1){
          lang.mixin(chartTypeInfo.display, paramsConfig1);
        }
        var chartOptions = this._getBasicChartOptionsByStatisticsInfo(mode, options, data, type);
        this._udpateJimuChartDisplayOptions(chartOptions, chartTypeInfo);

        var DEFAULT_CONFIG = {
          type: type || 'column',
          labels: [],
          series: [{
            data: []
          }]
        };
        var chart = new JimuChart({
          chartDom: chartDiv,
          config: DEFAULT_CONFIG
        });
        chart.placeAt(chartDiv);
        chart.resize();

        chart.updateConfig(chartOptions);
        this._bindChartEvent(chart, mode, data);

        if(this.showSettingIcon){
          this.own(on(paramsDijit, 'change', lang.hitch(this, function() {
            paramsDijit.showShelter();
            if (chart) {
              var paramsConfig2 = paramsDijit.getConfig();
              lang.mixin(chartTypeInfo.display, paramsConfig2);
              this._udpateJimuChartDisplayOptions(chartOptions, chartTypeInfo);
              chart.updateConfig(chartOptions);
            }
            paramsDijit.hideShelter();
          })));
        }

        return [chart, paramsDijit];
      },

      //get Chart display options by StatisticsChart display options
      _udpateJimuChartDisplayOptions: function(chartOptions, chartTypeInfo){
        var type = chartTypeInfo.type;
        var displayConfig = chartTypeInfo.display;

        this._settingAxisDisplay(chartOptions, displayConfig, type);

        chartOptions.type = type;
        chartOptions.dataZoom = ["inside", "slider"];
        chartOptions.confine = true;
        chartOptions.backgroundColor = displayConfig.backgroundColor;
        chartOptions.color = displayConfig.colors;

        var legendOption = {
          show: displayConfig.showLegend,
          textStyle: {}
        };
        if (displayConfig.legendTextColor) {
          legendOption.textStyle.color = displayConfig.legendTextColor;
        }
        if (displayConfig.legendTextSize) {
          legendOption.textStyle.fontSize = displayConfig.legendTextSize;
        }
        chartOptions.legend = legendOption;

        var dataLabelOption = {
          show: displayConfig.showDataLabel,
          textStyle: {}
        };
        if (displayConfig.dataLabelColor) {
          dataLabelOption.textStyle.color = displayConfig.dataLabelColor;
        }
        if (displayConfig.dataLabelSize) {
          dataLabelOption.textStyle.fontSize = displayConfig.dataLabelSize;
        }
        chartOptions.dataLabel = dataLabelOption;

        if(type === 'pie'){
          chartOptions.innerRadius = displayConfig.innerRadius;
        }

        return chartOptions;
      },

      _settingAxisDisplay: function(chartOptions, displayConfig, type) {
        var axisTypes = ['column', 'bar', 'line'];
        if (axisTypes.indexOf(type) < 0) {
          return;
        }
        var xAxisOption = {
          show: displayConfig.showHorizontalAxis,
          textStyle: {}
        };
        if (displayConfig.horizontalAxisTextColor) {
          xAxisOption.textStyle.color = displayConfig.horizontalAxisTextColor;
        }
        if (displayConfig.horizontalAxisTextSize) {
          xAxisOption.textStyle.fontSize = displayConfig.horizontalAxisTextSize;
        }
        chartOptions.xAxis = xAxisOption;

        var yAxisOption = {
          show: displayConfig.showVerticalAxis,
          textStyle: {}
        };
        if (displayConfig.verticalAxisTextColor) {
          yAxisOption.textStyle.color = displayConfig.verticalAxisTextColor;
        }
        if (displayConfig.verticalAxisTextSize) {
          yAxisOption.textStyle.fontSize = displayConfig.verticalAxisTextSize;
        }
        chartOptions.yAxis = yAxisOption;

        //axis chart, set stack and area
        if (!displayConfig.stack) {
          displayConfig.stack = false;
        }
        if ((type === 'column' || type === 'bar') || (type === 'line' && displayConfig.area)) {
          chartOptions.stack = displayConfig.stack;
        }
        //area
        if (type === 'line' && !displayConfig.area) {
          displayConfig.area = false;
        }

        if (type === 'line') {
          chartOptions.area = displayConfig.area;
        }
        //axisPointer, scale, hidexAxis, hideyAxis
        chartOptions.axisPointer = true;
        chartOptions.scale = false;
      },

      _getBasicChartOptionsByStatisticsInfo: function(mode, options, data, type){
        if(mode === 'feature' || mode === 'category'){
          return this._getCategoryModeChartOptionsByStatisticsInfo(options, data, type);
        }else if(mode === 'count'){
          return this._getCountModeChartOptionsByStatisticsInfo(data, type);
        }else if(mode === 'field'){
          return this._getFieldModeChartOptionByStatisticsInfo(data, type);
        }
        return null;
      },

      _bindChartEvent: function(chart, mode, data){
        if(!this.map){
          return;
        }
        if(data.length === 0){
          return;
        }
        var callback = lang.hitch(this, function(evt) {
          if (evt.componentType !== 'series') {
            return;
          }

          var features = null;

          if(mode === 'field'){
            features = this.features;
          }else{
            //category: {category,valueFields,dataFeatures:[f1,f2...]}
            //count {fieldValue:value1,count:count1,dataFeatures:[f1,f2...]}
            var a = data[evt.dataIndex];
            if (a) {
              features = a.dataFeatures;
            }
          }

          if(!features){
            return;
          }

          if (evt.type === 'mouseover') {
            this._mouseOverChartItem(features);
          } else if (evt.type === 'mouseout') {
            this._mouseOutChartItem(features);
          } else if (evt.type === 'click') {
            if(this.zoomToFeaturesWhenClick){
              this._zoomToGraphics(features);
            }
          }
        });

        var events = [{
          name: 'mouseover',
          callback: callback
        }, {
          name: 'mouseout',
          callback: callback
        }];
        if(this.zoomToFeaturesWhenClick){
          events.push({
            name: 'click',
            callback: callback
          });
        }
        array.forEach(events, lang.hitch(this, function(event) {
          chart.chart.on(event.name, event.callback);
        }));
      },

      //---------------create feature mode charts---------------
      _createFeatureModeCharts: function(args, chartDivs){
        var charts = [];
        var paramsDijits = [];
        var config = args.config;

        var options = {
          layerDefinition: this.featureLayer,
          popupFieldInfosObj: this.popupFieldInfosObj,
          features: args.features,
          labelField: config.labelField,
          valueFields: config.valueFields,
          sortOrder: config.sortOrder,
          maxLabels: config.maxLabels,
          useLayerSymbology: config.useLayerSymbology
        };
        if(this.featureLayerForChartSymbologyChart){
          options.featureLayerForChartSymbologyChart = this.featureLayerForChartSymbologyChart;
        }
        //data: [{category:'a',valueFields:[10,100,2],dataFeatures:[f1]}]
        var data = clientStatisticsUtils.getFeatureModeStatisticsInfo(options);

        array.forEach(config.types, lang.hitch(this, function(typeInfo, i){
          try {
            var chartDiv = chartDivs[i];
            var results = this._createJimuChart(chartDiv, 'feature', options, data, typeInfo);
            charts.push(results[0]);
            paramsDijits.push(results[1]);
          } catch (e) {
            console.error(e);
          }
        }));

        return {
          charts: charts,
          paramsDijits: paramsDijits
        };
      },

      //--------------------create category mode charts-------------------------
      _createCategoryModeCharts: function(args, chartDivs){
        /*jshint -W083 */
        var charts = [];
        var paramsDijits = [];
        var config = args.config;

        var options = {
          layerDefinition: this.featureLayer,
          popupFieldInfosObj: this.popupFieldInfosObj,
          features: args.features,
          categoryField: config.categoryField,
          valueFields: config.valueFields,
          operation: args.config.operation,
          sortOrder: config.sortOrder,
          dateConfig:config.dateConfig,
          maxLabels: config.maxLabels,
          nullValue: config.nullValue,
          useLayerSymbology: config.useLayerSymbology,
          splitField: config.splitField
        };
        if(this.featureLayerForChartSymbologyChart){
          options.featureLayerForChartSymbologyChart = this.featureLayerForChartSymbologyChart;
        }
        //data: [{category:'a',valueFields:[10,100,2],dataFeatures:[f1,f2...]}]
        var data = clientStatisticsUtils.getCategoryModeStatisticsInfo(options);

        array.forEach(config.types, lang.hitch(this, function(typeInfo, i){
          try {
            var chartDiv = chartDivs[i];
            var results = this._createJimuChart(chartDiv, 'category', options, data, typeInfo);
            charts.push(results[0]);
            paramsDijits.push(results[1]);
          } catch (e) {
            console.error(e);
          }
        }));

        return {
          charts: charts,
          paramsDijits: paramsDijits
        };
      },

      _getSplitedSeriesForCategoryOrCountMode: function(data, chartType) {
        var chartOptions = {
          type: chartType,
          labels: [],
          series: []
        };
        var allSplitedFields = [];
        data.forEach(function(item) {
          var splitedValueFields = item.splitedValueFields;
          if (splitedValueFields) {
            var fields = splitedValueFields.map(function(splitedValueField) {
              return splitedValueField.field;
            });
            allSplitedFields = allSplitedFields.concat(fields);
          }
        });
        var uniqueSeplitedFields = jimuUtils.uniqueArray(allSplitedFields);

        chartOptions.series = array.map(uniqueSeplitedFields, lang.hitch(this, function(uniqueSeplitedField) {
          var dataItem = [];
          for (var i = 0; i < data.length; i++) {
            dataItem[i] = null;
          }
          var item = {
            name: uniqueSeplitedField,
            type: chartType,
            data: dataItem
          };
          return item;
        }));

        array.forEach(data, lang.hitch(this, function(item, i) {
          //item: {category:'a',valueFields:[10,100,2] or {fieldValue:value1,count:count1}
          var label = '';
          if (item.category) {
            label = item.category;
          } else if (item.fieldValue) {
            label = item.fieldValue;
          }
          chartOptions.labels.push(label);

          item.splitedValueFields.forEach(function(svf) {
            chartOptions.series.forEach(function(serie) {
              if (serie.name === svf.field) {
                if (typeof item.color !== 'undefined') {
                  var dataObj = this._getSerieData(item, svf.value);
                  serie.data[i] = dataObj;
                } else {
                  serie.data[i] = svf.value;
                }
              }
            }.bind(this));
          }.bind(this));
        }));
        return chartOptions;
      },

      _getCategoryModeChartOptionsByStatisticsInfo: function(options, data, chartType) {
        //data: [{category:'a',valueFields:[10,100,2],dataFeatures:[f1,f2...]}]

        var valueFields = options.valueFields;
        var valueAliases = this._getFieldAliasArray(valueFields);
        var chartOptions = null;

        chartOptions = {
          type: chartType,
          labels: [],
          series: []
        };

        chartOptions.series = array.map(valueAliases, lang.hitch(this, function(valueFieldAlias) {
          var item = {
            name: valueFieldAlias,
            type: chartType,
            data: []
          };
          return item;
        }));

        array.forEach(data, lang.hitch(this, function(item) {
          //item: {category:'a',valueFields:[10,100,2]
          chartOptions.labels.push(item.category);
          for (var i = 0; i < item.valueFields.length; i++) {
            var num = item.valueFields[i];
            //color
            if (typeof item.color !== 'undefined') {
              var dataObj = this._getSerieData(item, num);
              chartOptions.series[i].data.push(dataObj);
            } else {
              chartOptions.series[i].data.push(num);
            }
          }
        }));

        return chartOptions;
      },

      _getSeriesOfRadar: function(data) {
        data = data.map(function(item) {
          return {
            name: item.category,
            value: item.valueFields
          };
        });
        return [{
          type: 'radar',
          data: data
        }];
      },

      _isAllFalseColor:function(data){
        return data.every(function(item){
          return !item.color;
        });
      },

      _getSerieData:function(item, num){
        if(!item.color){
          item.color = 'transparent';
        }
        var dataObj = {
          value:num,
          itemStyle:{
            normal:{
              color:item.color
            },emphasis:{
              color:item.color
            }
          }
        };
        return dataObj;
      },

      //------------------------create count mode charts--------------------------
      _createCountModeCharts: function(args, chartDivs){
        var charts = [];
        var paramsDijits = [];
        var config = args.config;

        var options = {
          layerDefinition: this.featureLayer,
          popupFieldInfosObj: this.popupFieldInfosObj,
          features: args.features,
          categoryField: config.categoryField,
          sortOrder: config.sortOrder,
          dateConfig:config.dateConfig,
          maxLabels: config.maxLabels,
          useLayerSymbology: config.useLayerSymbology,
          splitField: config.splitField
        };
        if(this.featureLayerForChartSymbologyChart){
          options.featureLayerForChartSymbologyChart = this.featureLayerForChartSymbologyChart;
        }
        //data:[{fieldValue:value1,count:count1,dataFeatures:[f1,f2...]}]
        var data = clientStatisticsUtils.getCountModeStatisticsInfo(options);

        array.forEach(config.types, lang.hitch(this, function(typeInfo, i){
          try {
            var chartDiv = chartDivs[i];
            var results = this._createJimuChart(chartDiv, 'count', options, data, typeInfo);
            charts.push(results[0]);
            paramsDijits.push(results[1]);
          } catch (e) {
            console.error(e);
          }
        }));

        return {
          charts: charts,
          paramsDijits: paramsDijits
        };
      },

      //options: {features, categoryField, sortOrder}
      //data: [{fieldValue:value1,count:count1,dataFeatures:[f1,f2...]}]
      _getCountModeChartOptionsByStatisticsInfo: function(data, chartType){
        //data: [{fieldValue:value1,count:count1,dataFeatures:[f1,f2...]}]
        var chartOptions = {
          type: chartType,
          labels: [],
          series: [{
            name: '',
            type: chartType,
            data: []
          }]
        };

        //[{fieldValue:value1,count:count1,dataFeatures:[f1,f2...]}]
        array.forEach(data, lang.hitch(this, function(item/*, index*/) {
          var num = item.count;
          var fieldValue = item.fieldValue;
          chartOptions.labels.push(fieldValue);
          if (typeof item.color !== 'undefined') {
            var dataObj = this._getSerieData(item, num);
            chartOptions.series[0].data.push(dataObj);
          } else {
            chartOptions.series[0].data.push(num);
          }
        }));

        return chartOptions;
      },

      //-----------------create field mode charts-------------------------
      _createFieldModeCharts: function(args, chartDivs){
        var charts = [];
        var paramsDijits = [];
        var config = args.config;

        var options = {
          layerDefinition: this.featureLayer,
          popupFieldInfosObj: this.popupFieldInfosObj,
          features: args.features,
          valueFields: config.valueFields,
          operation: config.operation,
          sortOrder: config.sortOrder,
          maxLabels: config.maxLabels,
          nullValue: config.nullValue
        };

        //data: [{label:fieldName,value:,fieldValue}]
        var data = clientStatisticsUtils.getFieldModeStatisticsInfo(options);

        array.forEach(config.types, lang.hitch(this, function(typeInfo, i){
          try {
            var chartDiv = chartDivs[i];
            var results = this._createJimuChart(chartDiv, 'field', options, data, typeInfo);
            charts.push(results[0]);
            paramsDijits.push(results[1]);
          } catch (e) {
            console.error(e);
          }
        }));

        return {
          charts: charts,
          paramsDijits: paramsDijits
        };
      },

      _getFieldModeChartOptionByStatisticsInfo: function(data, chartType){
        //data: [{label:fieldName,value:,fieldValue}]
        var chartOptions = {
          type: chartType,
          labels: [],
          series: [{
            name: '',
            type: chartType,
            data: []
          }]
        };

        array.forEach(data, lang.hitch(this, function(item) {
          var aliasName = this._getFieldAlias(item.label);
          chartOptions.labels.push(aliasName);
          chartOptions.series[0].data.push(item.value);
        }));

        return chartOptions;
      }

    });
  });