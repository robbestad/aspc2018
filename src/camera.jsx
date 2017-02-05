import React from 'react';
import classNames from 'classnames';
import ImageToCanvas from 'imagetocanvas';
import request from 'superagent';
const {resizeImage} = require('./helperfncs');

function getOrientation(file, callback) {
  const reader = new FileReader();
  reader.onload = function (e) {
    const view = new DataView(e.target.result);
    if (view.getUint16(0, false) != 0xFFD8) return callback(-2);
    let length = view.byteLength, offset = 2;
    while (offset < length) {
      let marker = view.getUint16(offset, false);
      offset += 2;
      if (marker == 0xFFE1) {
        if (view.getUint32(offset += 2, false) != 0x45786966) return callback(-1);
        let little = view.getUint16(offset += 6, false) == 0x4949;
        offset += view.getUint32(offset + 4, little);
        let tags = view.getUint16(offset, little);
        offset += 2;
        for (let i = 0; i < tags; i++)
          if (view.getUint16(offset + (i * 12), little) == 0x0112)
            return callback(view.getUint16(offset + (i * 12) + 8, little));
      }
      else if ((marker & 0xFF00) != 0xFF00) break;
      else offset += view.getUint16(offset, false);
    }
    return callback(-1);
  };
  reader.readAsArrayBuffer(file);
}

function toImg(encodedData) {
  const imgElement = document.createElement('img');
  imgElement.src = encodedData;
  return imgElement;
}

function toPng(canvas) {
  const img = document.createElement('img');
  img.src = canvas.toDataURL('image/png');
  return img;
}


function serializeImage(dataURL) {
  const BASE64_MARKER = ';base64,';
  if (dataURL.indexOf(BASE64_MARKER) == -1) {
    const parts = dataURL.split(',');
    const contentType = parts[0].split(':')[1];
    const raw = decodeURIComponent(parts[1]);
    return new Blob([raw], {type: contentType});
  }
  const parts = dataURL.split(BASE64_MARKER);
  const contentType = parts[0].split(':')[1];
  const raw = window.atob(parts[1]);
  const rawLength = raw.length;

  const uInt8Array = new Uint8Array(rawLength);

  for (let i = 0; i < rawLength; ++i) {
    uInt8Array[i] = raw.charCodeAt(i);
  }

  return new Blob([uInt8Array], {type: contentType});
}

export default class Camera extends React.Component {
  constructor() {
    super();
    this.state = {
      imageLoaded: false,
      imageCanvasDisplay: 'none',
      spinnerDisplay: false,
      imageCanvasWidth: '28px',
      imageCanvasHeight: '320px',
      faceApiText: null,
      storingFace: false,
      userData: '',
      detectedFaces: null,
      faceDataFound: false,
      currentImg: null
    };
    this.putImage = this.putImage.bind(this);
    this.takePhoto = this.takePhoto.bind(this);
    this.faceRecog = this.faceRecog.bind(this);
    this.uploadImage = this.uploadImage.bind(this);
    this.createPersistedFaceID = this.createPersistedFaceID.bind(this);
    this.addPersonFace = this.addPersonFace.bind(this);
    this.createPerson = this.createPerson.bind(this);
    this.trainGroup = this.trainGroup.bind(this);
  }

  putImage(img, orientation) {
    const canvas = this.refs.photoCanvas;
    const ctx = canvas.getContext("2d");
    let w = img.width;
    let h = img.height;

    const {sw, sh} = resizeImage(w, h);

    console.log("ORIGINAL DIMENSIONS", w, h, "RESIZED DIM", sw, sh);

    let tempCanvas = document.createElement('canvas');
    let tempCtx = tempCanvas.getContext('2d');
    tempCanvas.width = sw;
    tempCanvas.height = sh;
    tempCtx.drawImage(img, 0, 0, sw, sh);
    ImageToCanvas.drawCanvas(canvas, img, orientation, sw, sh, 1, 0, false);
  }

  takePhoto(event) {
    let camera = this.refs.camera,
      files = event.target.files,
      file, w, h, mpImg, orientation;
    if (files && files.length > 0) {
      file = files[0];
      const fileReader = new FileReader();
      const putImage = this.putImage;
      fileReader.onload = (event) => {
        const img = new Image();
        img.src = event.target.result;
        const _this = this;
        img.onload = () => {
          getOrientation(file, (orientation) => {
            if (orientation < 0) orientation = 1;
            this.putImage(img, orientation);
            this.setState({imageLoaded: true, currentImg: img.src});
            this.faceRecog();

          });
        }
      };

      fileReader.readAsDataURL(file);
    }
  }


  faceRecog() {
    let canvas = this.refs.photoCanvas;
    const dataURL = canvas.toDataURL();

    this.setState({
      spinnerDisplay: true
    });


    // There's two ways to send images to the cognitive API.
    // 1. Send a Image URL (need to set Content-Type as application/json)
    // 2. Send a binary (need to set Content-Type as octet-stream). The image need to be serialized.
    request
      .post('https://westus.api.cognitive.microsoft.com/face/v1.0/detect?returnFaceId=true&returnFaceLandmarks=false')
      .send(serializeImage(this.state.currentImg))
      .set('Content-Type', 'application/octet-stream')
      // .send({url: "http://techbeat.com/wp-content/uploads/2013/06/o-GOOGLE-FACIAL-RECOGNITION-facebook-1024x767.jpg"})
      // .set('Content-Type', 'application/json')
      .set('Ocp-Apim-Subscription-Key', '286fe5360c85463bac4315dff365fdc2')
      .set('processData', false)
      .set('Accept', 'application/json')
      .end((err, res) => {
        if (err || !res.ok) {
          console.error(err);
        } else {
          const data = JSON.stringify(res.body);
          console.log(data);
          const faces = res.body.map(f => {
            return {
              faceId: f.faceId,
              target: '' + f.faceRectangle.top + ',' + f.faceRectangle.left + ',' + f.faceRectangle.width + ',' + f.faceRectangle.height,
              faceRectangle: f.faceRectangle
            }
          });
          this.setState({
            detectedFaces: faces,
            faceApiText: data,
            faceDataFound: true,
            spinnerDisplay: false
          })
        }
      });
  }

  createPersistedFaceID() {
    //RETURNS A PERSISTED FACE ID

    let canvas = this.refs.photoCanvas;
    const dataURL = canvas.toDataURL();

    const {userData} = this.state;
    return new Promise((resolve, reject) => {
      request
        .post('https://westus.api.cognitive.microsoft.com/face/v1.0/facelists/aspc2017faces/persistedFaces')
        .send(serializeImage(this.state.currentImg))
        .set('Content-Type', 'application/octet-stream')
        .set('Ocp-Apim-Subscription-Key', '286fe5360c85463bac4315dff365fdc2')
        .set('Accept', 'application/json')
        .end((err, res) => {
          if (err || !res.ok) {
            console.error(err);
          } else {
            resolve(res.body);
          }
        })
    });
  }

  createPerson() {
    // RETURNS a personId
    const {userData} = this.state;
    return new Promise((resolve, reject) => {
      request
        .post('https://westus.api.cognitive.microsoft.com/face/v1.0/persongroups/aspc2017facegroup/persons')
        .send({
          "name": this.refs.inputname.value,
          "userData": this.refs.inputdata.value
        })
        .set('Ocp-Apim-Subscription-Key', '286fe5360c85463bac4315dff365fdc2')
        .set('Content-Type', 'application/json')
        .set('Accept', 'application/json')
        .end((err, res) => {
          if (err || !res.ok) {
            console.error(err);
          } else {
            const data = JSON.stringify(res.body);
            resolve(res.body.personId);
          }
        })
    });
  }

  trainGroup() {
    // RETURNS a personId
    const {userData} = this.state;
    return new Promise((resolve, reject) => {
      request
        .post('https://westus.api.cognitive.microsoft.com/face/v1.0/persongroups/aspc2017facegroup/train')
        .set('Ocp-Apim-Subscription-Key', '286fe5360c85463bac4315dff365fdc2')
        .set('Content-Type', 'application/json')
        .set('Accept', 'application/json')
        .end((err, res) => {
          if (err || !res.ok) {
            console.error(err);
          } else {
            const data = JSON.stringify(res.body);
            resolve(res.body.personId);
          }
        })
    });
  }

  addPersonFace(personId, targetFace) {
    const {userData} = this.state;
    return new Promise((resolve, reject) => {
      request
        .post('https://westus.api.cognitive.microsoft.com/face/v1.0/persongroups/aspc2017facegroup/persons/' + personId + '/persistedFaces')
        .send(serializeImage(this.state.currentImg))
        .set('Content-Type', 'application/octet-stream')
        .set('Ocp-Apim-Subscription-Key', '286fe5360c85463bac4315dff365fdc2')
        .set('Accept', 'application/json')
        .end((err, res) => {
          if (err || !res.ok) {
            console.error(err);
          } else {
            const data = JSON.stringify(res.body);
            resolve(data);
          }
        })
    });

  }


  uploadImage() {
    // store ID to FACE API

    this.setState({
      spinnerDisplay: true,
      storingFace: true
    });

    // CREATE A PERSISTED FACE ID
    this.createPersistedFaceID()
      .then(persistedFaceId => {

        // CREATE A PERSON
        this.createPerson()
          .then(personId => {
            // ADD A PERSON FACE

            this.addPersonFace(personId)
              .then(persistedGroupFaceId => {

                this.trainGroup()
                  .then(() => {
                    // Returns a persistedGroupFaceId
                    console.log('success');
                    console.log('persistedFaceId', persistedFaceId);
                    console.log('personId', personId);
                    console.log('persistedGroupFaceId', persistedGroupFaceId);
                    window.location.href = "/#uploaded";
                  })

              })
              .catch(err => {
                alert(JSON.stringify(err));
              });
          })
          .catch(err => {
            alert(JSON.stringify(err));
          });
      })
      .catch(err => {
        alert(JSON.stringify(err));
      });


  }

  render() {
    const canvasCSS = classNames({
      hidden: !this.state.faceDataFound,
      cameraFrame: true
    });
    const buttonCSS = classNames({
      hidden: this.state.imageLoaded
    });
    const spinnerCSS = classNames({
      hidden: !this.state.spinnerDisplay
    });
    const innerSpinnerCSS = classNames({
      spinner: true
    });

    const addCSS = classNames({
      hidden: !this.state.faceDataFound,
      metaInput: true
    });

    const specialHideCSS = classNames({
      hidden: this.state.storingFace
    });


    return <div>
      <h1 className="center">ADD A PERSON</h1>
      <div className="center">

        <div className={buttonCSS}>
          <label className="camera-snap">
            <img src="/assets/camera.svg" className="icon-camera"
                 alt="Click to snap a photo or select an image from your photo roll"/>
            <input type="file" label="Camera" onChange={this.takePhoto}
                   ref="camera" className="camera" accept="image/*"/>
          </label>
        </div>


        <div className={spinnerCSS}>
          <div className={innerSpinnerCSS}>
            <div className="double-bounce1"></div>
            <div className="double-bounce2"></div>
          </div>
        </div>

        <div className={specialHideCSS}>
          <div className={canvasCSS}>
            <canvas ref="photoCanvas" className="imageCanvas">
              Your browser does not support the HTML5 canvas tag.
            </canvas>
          </div>


          <div className={addCSS}>
            <label htmlFor="name">NAME</label>
            <input id="name" type="text" ref="inputname" className="darkInput"/>

            <label htmlFor="metadata">METADATA</label>
            <textarea id="metadata" ref="inputdata" className="darkInput"/>

            <label htmlFor="addBtn"></label>
            <button id="addBtn" className="darkButton" onClick={this.uploadImage} value="add">ADD</button>
          </div>
        </div>


      </div>
    </div>
  }
}
